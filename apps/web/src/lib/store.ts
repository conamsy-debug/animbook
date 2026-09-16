import { create } from "zustand";
import type { BookSummary, LibraryEntry, PageRecord } from "@/lib/api";
import type { ReadingMode } from "../domain/index.js";

export interface ReaderState {
  book: BookSummary;
  pages: PageRecord[];
  pageIndex: number;
  mode: ReadingMode;
  isFlipping: boolean;
  flippingDirection: "next" | "prev";
  setBook(book: BookSummary, pages: PageRecord[]): void;
  goTo(index: number): void;
  flipNext(): void;
  flipPrev(): void;
  setMode(mode: ReadingMode): void;
  finishFlip(): void;
}

export const useReaderStore = create<ReaderState>((set, get) => ({
  book: { id: "", slug: "", title: "", author: "", synopsis: "", vertical: "CONSUMER", genreTags: [], moodTags: [], ageRating: null, language: "en", coverUrl: null, totalPages: 0, styleId: null },
  pages: [],
  pageIndex: 0,
  mode: "BOTH",
  isFlipping: false,
  flippingDirection: "next",
  setBook(book, pages) {
    set({ book, pages, pageIndex: 0, isFlipping: false });
  },
  goTo(index) {
    const { pages } = get();
    if (index < 0 || index >= pages.length) return;
    set({ pageIndex: index });
  },
  flipNext() {
    const { pages, pageIndex, isFlipping } = get();
    if (isFlipping || pageIndex >= pages.length - 1) return;
    set({ isFlipping: true, flippingDirection: "next" });
    setTimeout(() => {
      set({ pageIndex: pageIndex + 1, isFlipping: false });
    }, 520);
  },
  flipPrev() {
    const { pageIndex, isFlipping } = get();
    if (isFlipping || pageIndex <= 0) return;
    set({ isFlipping: true, flippingDirection: "prev" });
    setTimeout(() => {
      set({ pageIndex: pageIndex - 1, isFlipping: false });
    }, 520);
  },
  setMode(mode) {
    set({ mode });
  },
  finishFlip() {
    set({ isFlipping: false });
  }
}));

export interface LibraryState {
  entries: LibraryEntry[];
  hydrated: boolean;
  hydrate(entries: LibraryEntry[]): void;
  upsert(entry: LibraryEntry): void;
}

export const useLibraryStore = create<LibraryState>((set) => ({
  entries: [],
  hydrated: false,
  hydrate(entries) {
    set({ entries, hydrated: true });
  },
  upsert(entry) {
    set((state) => {
      const filtered = state.entries.filter((e) => e.bookId !== entry.bookId);
      return { entries: [entry, ...filtered] };
    });
  }
}));

export interface ToastState {
  message: string | null;
  push(message: string): void;
  dismiss(): void;
}

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  push(message) {
    set({ message });
    setTimeout(() => set({ message: null }), 2400);
  },
  dismiss() {
    set({ message: null });
  }
}));