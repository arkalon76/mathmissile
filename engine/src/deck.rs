//! Plays the shell's deck in order (DESIGN §2.4–2.5, §2.8): the uniqueness
//! look-ahead when spawning and the in-round repetition after a wrong or an
//! escape. No allocation after `load` (the slot vector reserves the growth).

use crate::config::Slot;
use crate::facts::Fact;
use crate::tuning::*;

#[derive(Clone, Copy, Debug)]
struct FactCount {
    key: (i32, i32, u8),
    appearances: u8,
    wrong_inserts: u8,
    escape_inserted: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Insert {
    /// Replaced the slot at this index.
    Replaced(usize),
    Appended(usize),
    /// Dropped (limits reached).
    Dropped,
}

pub struct Deck {
    pub slots: Vec<Slot>,
    /// Next unplayed slot.
    pub front: usize,
    appended: u8,
    /// Boss rounds: copies go to the back with no limits.
    boss: bool,
    counts: Vec<FactCount>,
}

const BOSS_MAX_SLOTS: usize = 160;

impl Deck {
    pub fn new() -> Deck {
        Deck { slots: Vec::with_capacity(64), front: 0, appended: 0, boss: false, counts: Vec::with_capacity(64) }
    }

    pub fn load(&mut self, slots: &[Slot], boss: bool) {
        self.slots.clear();
        self.slots.extend_from_slice(slots);
        let want = slots.len() + if boss { BOSS_MAX_SLOTS } else { MAX_APPENDED as usize + 1 };
        if self.slots.capacity() < want {
            self.slots.reserve(want - self.slots.len());
        }
        self.front = 0;
        self.appended = 0;
        self.boss = boss;
        self.counts.clear();
        for s in slots {
            let i = self.count_idx(s.fact);
            self.counts[i].appearances = self.counts[i].appearances.saturating_add(1);
        }
    }

    pub fn remaining(&self) -> usize {
        self.slots.len() - self.front
    }

    pub fn is_empty(&self) -> bool {
        self.remaining() == 0
    }

    pub fn peek(&self) -> Option<&Slot> {
        self.slots.get(self.front)
    }

    fn count_idx(&mut self, f: Fact) -> usize {
        let key = f.key();
        if let Some(i) = self.counts.iter().position(|c| c.key == key) {
            return i;
        }
        self.counts.push(FactCount { key, appearances: 0, wrong_inserts: 0, escape_inserted: false });
        self.counts.len() - 1
    }

    /// Take the front slot, or the first of the next `LOOKAHEAD` slots that
    /// passes `ok` (swapped to the front). None: wait and retry.
    pub fn take_next(&mut self, ok: impl Fn(&Slot) -> bool) -> Option<Slot> {
        let end = (self.front + 1 + LOOKAHEAD).min(self.slots.len());
        let pick = (self.front..end).find(|&i| ok(&self.slots[i]))?;
        self.slots.swap(self.front, pick);
        let s = self.slots[self.front];
        self.front += 1;
        Some(s)
    }

    /// Index of the slot that would be taken next (for intro cards).
    pub fn next_index(&self, ok: impl Fn(&Slot) -> bool) -> Option<usize> {
        let end = (self.front + 1 + LOOKAHEAD).min(self.slots.len());
        (self.front..end).find(|&i| ok(&self.slots[i]))
    }

    /// §2.5 after a wrong. `nth` is 1 for the first wrong on this fact in the
    /// round, 2 for the second.
    pub fn on_wrong(&mut self, s: &Slot) -> Insert {
        if self.boss {
            return self.to_back(s);
        }
        let i = self.count_idx(s.fact);
        let c = self.counts[i];
        if c.wrong_inserts >= MAX_WRONG_INSERTS || c.appearances >= MAX_APPEARANCES {
            return Insert::Dropped;
        }
        let back = if c.wrong_inserts == 0 { WRONG_INSERT_1 } else { WRONG_INSERT_2 };
        let r = self.insert(s, back);
        if r != Insert::Dropped {
            self.counts[i].wrong_inserts += 1;
        }
        r
    }

    /// §2.5 after an escape: one copy 4 back, once per fact.
    pub fn on_escape(&mut self, s: &Slot) -> Insert {
        if self.boss {
            return self.to_back(s);
        }
        let i = self.count_idx(s.fact);
        let c = self.counts[i];
        if c.escape_inserted || c.appearances >= MAX_APPEARANCES {
            return Insert::Dropped;
        }
        let r = self.insert(s, ESCAPE_INSERT);
        if r != Insert::Dropped {
            self.counts[i].escape_inserted = true;
        }
        r
    }

    fn to_back(&mut self, s: &Slot) -> Insert {
        if self.slots.len() >= self.slots.capacity() {
            return Insert::Dropped;
        }
        self.slots.push(s.repeat_copy());
        Insert::Appended(self.slots.len() - 1)
    }

    /// "3 slots behind the front": index `front + back - 1`, so `back - 1`
    /// other sums come first.
    fn insert(&mut self, s: &Slot, back: usize) -> Insert {
        let copy = s.repeat_copy();
        let from = self.front + back - 1;
        // Never replace a slot carrying a special intro: the shell marks that
        // special as seen when it plans the round, so the intro must play.
        if let Some(j) = (from..self.slots.len()).find(|&j| self.slots[j].kind.replaceable() && !self.slots[j].intro) {
            let old = self.slots[j].fact;
            let oi = self.count_idx(old);
            self.counts[oi].appearances = self.counts[oi].appearances.saturating_sub(1);
            self.slots[j] = copy;
            let ni = self.count_idx(s.fact);
            self.counts[ni].appearances += 1;
            return Insert::Replaced(j);
        }
        if self.appended >= MAX_APPENDED {
            return Insert::Dropped;
        }
        self.appended += 1;
        self.slots.push(copy);
        let ni = self.count_idx(s.fact);
        self.counts[ni].appearances += 1;
        Insert::Appended(self.slots.len() - 1)
    }
}

impl Default for Deck {
    fn default() -> Self {
        Deck::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{SlotKind, SlotKind::*};

    fn deck(kinds: &[(i32, SlotKind)]) -> Deck {
        let slots: Vec<Slot> = kinds.iter().map(|&(b, k)| Slot::plain(Fact::mul(2, b), k)).collect();
        let mut d = Deck::new();
        d.load(&slots, false);
        d
    }

    #[test]
    fn wrong_never_replaces_an_intro_slot() {
        let mut d = deck(&[(1, Focus), (2, Focus), (3, Focus), (4, Focus), (5, Focus)]);
        d.slots[3].special = crate::config::Special::Armored;
        d.slots[3].intro = true;
        let first = d.take_next(|_| true).unwrap();
        // front + 2 = index 3 carries the intro; index 4 is replaced instead.
        assert_eq!(d.on_wrong(&first), Insert::Replaced(4));
        assert!(d.slots[3].intro);
        assert_eq!(d.slots[3].special, crate::config::Special::Armored);
        // On escape with only the intro slot left in range, the copy is appended.
        let mut d = deck(&[(1, Focus), (2, Focus), (3, Focus), (4, Focus), (5, Focus)]);
        d.slots[4].special = crate::config::Special::Freeze;
        d.slots[4].intro = true;
        let first = d.take_next(|_| true).unwrap();
        assert_eq!(d.on_escape(&first), Insert::Appended(5));
        assert!(d.slots[4].intro);
    }

    #[test]
    fn wrong_replaces_focus_three_back_never_new_or_tricky() {
        let mut d = deck(&[(1, Focus), (2, Focus), (3, New), (4, Tricky), (5, Focus), (6, Review), (7, Focus)]);
        let first = d.take_next(|_| true).unwrap();
        assert_eq!(d.front, 1);
        // front + 2 = index 3 (Tricky) is skipped; index 4 (Focus) is replaced.
        assert_eq!(d.on_wrong(&first), Insert::Replaced(4));
        assert_eq!(d.slots[4].fact, first.fact);
        assert_eq!(d.slots[4].kind, Repeat);
        // Second wrong goes 4 back: from index 4 on, slot 4 is now a Repeat, 5 is Review.
        assert_eq!(d.on_wrong(&first), Insert::Replaced(5));
        // Never more than 2 inserts.
        assert_eq!(d.on_wrong(&first), Insert::Dropped);
        assert_eq!(d.slots.len(), 7, "fixed length while replaceable slots remain");
    }

    #[test]
    fn appends_at_most_four_and_caps_appearances() {
        let mut d = deck(&[(1, New), (2, New), (3, New), (4, New), (5, New), (6, New)]);
        for _ in 0..6 {
            d.take_next(|_| true);
        }
        let s = Slot::plain(Fact::mul(3, 3), New);
        let mut appended = 0;
        for b in 1..=8 {
            let f = Slot::plain(Fact::mul(4, b), New);
            if let Insert::Appended(_) = d.on_wrong(&f) {
                appended += 1;
            }
        }
        assert_eq!(appended, 4);
        assert_eq!(d.on_escape(&s), Insert::Dropped);
        let cap = d.slots.capacity();
        assert!(d.slots.len() <= cap);

        // Appearance cap: a fact already 4 times in the deck gets no copy.
        let mut d = deck(&[(1, Focus), (1, Focus), (1, Focus), (1, Focus), (2, Focus), (3, Focus), (4, Focus), (5, Focus)]);
        let f = d.take_next(|_| true).unwrap();
        assert_eq!(d.on_wrong(&f), Insert::Dropped);
    }

    #[test]
    fn escape_once_per_fact_and_form_shares_key() {
        let mut d = deck(&[(3, Focus), (1, Focus), (2, Focus), (4, Focus), (5, Focus), (6, Focus), (7, Focus)]);
        let f = d.take_next(|_| true).unwrap();
        assert_eq!(d.on_escape(&f), Insert::Replaced(4));
        let swapped = Slot::plain(Fact::mul(3, 2), Focus);
        assert_eq!(d.on_escape(&swapped), Insert::Dropped, "3x2 and 2x3 are one fact");
    }

    #[test]
    fn lookahead_swaps_first_passing_slot() {
        let mut d = deck(&[(1, Focus), (2, Focus), (3, Focus), (4, Focus), (5, Focus), (6, Focus), (7, Focus)]);
        let s = d.take_next(|s| s.fact.answer == 8).unwrap();
        assert_eq!(s.fact.b, 4);
        assert_eq!(d.slots[1].fact.b, 2);
        assert_eq!(d.slots[3].fact.b, 1, "the skipped front moved to the picked slot");
        assert!(d.take_next(|s| s.fact.answer == 14).is_none(), "beyond look-ahead 4");
        assert_eq!(d.front, 1);
    }

    #[test]
    fn boss_copies_go_to_back() {
        let slots: Vec<Slot> = (1..=3).map(|b| Slot::plain(Fact::mul(2, b), Focus)).collect();
        let mut d = Deck::new();
        d.load(&slots, true);
        let f = d.take_next(|_| true).unwrap();
        for _ in 0..6 {
            assert!(matches!(d.on_wrong(&f), Insert::Appended(_)));
        }
        assert_eq!(d.slots.len(), 9);
    }
}
