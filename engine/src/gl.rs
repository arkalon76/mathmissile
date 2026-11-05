//! WebGL2 renderer: one program, one instanced quad draw per frame.

use wasm_bindgen::{JsCast, JsValue};
use web_sys::{
    HtmlCanvasElement, WebGl2RenderingContext as GL, WebGlBuffer, WebGlContextAttributes, WebGlPowerPreference, WebGlProgram,
    WebGlShader, WebGlTexture, WebGlUniformLocation, WebGlVertexArrayObject,
};

use crate::draw::{InstanceWriter, FLOATS_PER_INSTANCE, MAX_INSTANCES};
use crate::shaders;

pub struct Renderer {
    gl: GL,
    r: Res,
    /// Source of the atlas texture, kept so it can be re-uploaded after a
    /// context loss.
    atlas_src: Option<HtmlCanvasElement>,
}

/// Everything that lives in the GL context (gone after a context loss).
struct Res {
    program: WebGlProgram,
    vao: WebGlVertexArrayObject,
    inst_buf: WebGlBuffer,
    atlas: Option<WebGlTexture>,
    u_view: Option<WebGlUniformLocation>,
    u_cam: Option<WebGlUniformLocation>,
    u_time: Option<WebGlUniformLocation>,
    u_atlas: Option<WebGlUniformLocation>,
    _quad_buf: WebGlBuffer,
}

fn compile(gl: &GL, ty: u32, src: &str) -> Result<WebGlShader, JsValue> {
    let sh = gl.create_shader(ty).ok_or("create_shader failed")?;
    gl.shader_source(&sh, src);
    gl.compile_shader(&sh);
    if gl.get_shader_parameter(&sh, GL::COMPILE_STATUS).as_bool().unwrap_or(false) {
        Ok(sh)
    } else {
        Err(JsValue::from_str(&format!("shader compile error: {}", gl.get_shader_info_log(&sh).unwrap_or_default())))
    }
}

impl Renderer {
    /// `portrait`: transparent, preserved drawing buffer (for toDataURL).
    pub fn new(canvas: &HtmlCanvasElement, portrait: bool) -> Result<Renderer, JsValue> {
        let attrs = WebGlContextAttributes::new();
        attrs.set_alpha(portrait);
        attrs.set_antialias(false);
        attrs.set_depth(false);
        attrs.set_stencil(false);
        attrs.set_premultiplied_alpha(true);
        attrs.set_preserve_drawing_buffer(portrait);
        attrs.set_power_preference(WebGlPowerPreference::HighPerformance);
        let gl: GL = canvas
            .get_context_with_context_options("webgl2", &attrs)?
            .ok_or("WebGL2 is not available")?
            .dyn_into()?;
        let r = Res::new(&gl)?;
        Ok(Renderer { gl, r, atlas_src: None })
    }

    /// Rebuild program, buffers and the atlas texture after
    /// `webglcontextrestored`. Errors if the context is still lost.
    pub fn restore(&mut self) -> Result<(), JsValue> {
        if self.gl.is_context_lost() {
            return Err(JsValue::from_str("WebGL context is still lost"));
        }
        self.r = Res::new(&self.gl)?;
        if let Some(c) = self.atlas_src.clone() {
            self.upload_atlas(&c)?;
        }
        Ok(())
    }

    pub fn set_atlas(&mut self, canvas: &HtmlCanvasElement) -> Result<(), JsValue> {
        self.atlas_src = Some(canvas.clone());
        self.upload_atlas(canvas)
    }
}

impl Res {
    fn new(gl: &GL) -> Result<Res, JsValue> {
        let vs = compile(&gl, GL::VERTEX_SHADER, shaders::VERT)?;
        let fs = compile(&gl, GL::FRAGMENT_SHADER, shaders::FRAG)?;
        let program = gl.create_program().ok_or("create_program failed")?;
        gl.attach_shader(&program, &vs);
        gl.attach_shader(&program, &fs);
        gl.link_program(&program);
        if !gl.get_program_parameter(&program, GL::LINK_STATUS).as_bool().unwrap_or(false) {
            return Err(JsValue::from_str(&format!("link error: {}", gl.get_program_info_log(&program).unwrap_or_default())));
        }
        gl.delete_shader(Some(&vs));
        gl.delete_shader(Some(&fs));

        let vao = gl.create_vertex_array().ok_or("create_vertex_array failed")?;
        gl.bind_vertex_array(Some(&vao));

        let quad_buf = gl.create_buffer().ok_or("create_buffer failed")?;
        gl.bind_buffer(GL::ARRAY_BUFFER, Some(&quad_buf));
        let quad: [f32; 8] = [-1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0, 1.0];
        unsafe {
            let view = js_sys::Float32Array::view(&quad);
            gl.buffer_data_with_array_buffer_view(GL::ARRAY_BUFFER, &view, GL::STATIC_DRAW);
        }
        gl.enable_vertex_attrib_array(0);
        gl.vertex_attrib_pointer_with_i32(0, 2, GL::FLOAT, false, 8, 0);

        let inst_buf = gl.create_buffer().ok_or("create_buffer failed")?;
        gl.bind_buffer(GL::ARRAY_BUFFER, Some(&inst_buf));
        let bytes = (MAX_INSTANCES * FLOATS_PER_INSTANCE * 4) as i32;
        gl.buffer_data_with_i32(GL::ARRAY_BUFFER, bytes, GL::DYNAMIC_DRAW);
        let stride = (FLOATS_PER_INSTANCE * 4) as i32;
        for loc in 1..=7u32 {
            gl.enable_vertex_attrib_array(loc);
            gl.vertex_attrib_pointer_with_i32(loc, 4, GL::FLOAT, false, stride, ((loc - 1) * 16) as i32);
            gl.vertex_attrib_divisor(loc, 1);
        }
        gl.bind_vertex_array(None);

        let u_view = gl.get_uniform_location(&program, "u_view");
        let u_cam = gl.get_uniform_location(&program, "u_cam");
        let u_time = gl.get_uniform_location(&program, "u_time");
        let u_atlas = gl.get_uniform_location(&program, "u_atlas");

        gl.disable(GL::DEPTH_TEST);
        gl.enable(GL::BLEND);
        // Premultiplied alpha; additive instances output alpha = 0.
        gl.blend_func(GL::ONE, GL::ONE_MINUS_SRC_ALPHA);

        Ok(Res { program, vao, inst_buf, atlas: None, u_view, u_cam, u_time, u_atlas, _quad_buf: quad_buf })
    }
}

impl Renderer {
    fn upload_atlas(&mut self, canvas: &HtmlCanvasElement) -> Result<(), JsValue> {
        let gl = &self.gl;
        let tex = gl.create_texture().ok_or("create_texture failed")?;
        gl.bind_texture(GL::TEXTURE_2D, Some(&tex));
        gl.pixel_storei(GL::UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);
        gl.pixel_storei(GL::UNPACK_FLIP_Y_WEBGL, 0);
        gl.tex_image_2d_with_u32_and_u32_and_html_canvas_element(GL::TEXTURE_2D, 0, GL::RGBA as i32, GL::RGBA, GL::UNSIGNED_BYTE, canvas)?;
        gl.generate_mipmap(GL::TEXTURE_2D);
        gl.tex_parameteri(GL::TEXTURE_2D, GL::TEXTURE_MIN_FILTER, GL::LINEAR_MIPMAP_LINEAR as i32);
        gl.tex_parameteri(GL::TEXTURE_2D, GL::TEXTURE_MAG_FILTER, GL::LINEAR as i32);
        gl.tex_parameteri(GL::TEXTURE_2D, GL::TEXTURE_WRAP_S, GL::CLAMP_TO_EDGE as i32);
        gl.tex_parameteri(GL::TEXTURE_2D, GL::TEXTURE_WRAP_T, GL::CLAMP_TO_EDGE as i32);
        self.r.atlas = Some(tex);
        Ok(())
    }

    pub fn is_context_lost(&self) -> bool {
        self.gl.is_context_lost()
    }

    /// Draw the instances. `px_w/px_h` = drawing-buffer size; `view` = world size.
    #[allow(clippy::too_many_arguments)]
    pub fn draw(&self, w: &InstanceWriter, px_w: i32, px_h: i32, view: (f32, f32), cam: (f32, f32), time: f32, clear: [f32; 4]) {
        let gl = &self.gl;
        gl.viewport(0, 0, px_w, px_h);
        gl.clear_color(clear[0], clear[1], clear[2], clear[3]);
        gl.clear(GL::COLOR_BUFFER_BIT);
        if w.count == 0 {
            return;
        }
        gl.use_program(Some(&self.r.program));
        gl.uniform2f(self.r.u_view.as_ref(), view.0, view.1);
        gl.uniform2f(self.r.u_cam.as_ref(), cam.0, cam.1);
        gl.uniform1f(self.r.u_time.as_ref(), time);
        gl.active_texture(GL::TEXTURE0);
        gl.bind_texture(GL::TEXTURE_2D, self.r.atlas.as_ref());
        gl.uniform1i(self.r.u_atlas.as_ref(), 0);
        gl.bind_vertex_array(Some(&self.r.vao));
        gl.bind_buffer(GL::ARRAY_BUFFER, Some(&self.r.inst_buf));
        // SAFETY: the view is used immediately, before any Rust allocation can
        // grow (and detach) wasm memory.
        unsafe {
            let view = js_sys::Float32Array::view(&w.data[..w.count * FLOATS_PER_INSTANCE]);
            gl.buffer_sub_data_with_i32_and_array_buffer_view(GL::ARRAY_BUFFER, 0, &view);
        }
        gl.draw_arrays_instanced(GL::TRIANGLE_STRIP, 0, 4, w.count as i32);
        gl.bind_vertex_array(None);
    }
}
