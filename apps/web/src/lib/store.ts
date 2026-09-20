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
    // Setting the same book again (e.g. a re-render with fresh objects) must
    // not throw the reader back to page 1.
    const current = get();
    const sameBook = current.book.id === book.id && current.pages.length === pages.length;
    set({
      book,
      pages,
      pageIndex: sameBook ? Math.min(current.pageIndex, Math.max(0, pages.length - 1)) : 0,
      isFlipping: sameBook ? current.isFlipping : false
    });
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
  push(message: string, durationMs?: number): void;
  dismiss(): void;
}

export const useToastStore = create<ToastState>((set) => ({
  message: null,
  push(message, durationMs) {
    set({ message });
    // Default 4s — long enough to read a URL, short enough to not pile up
    // if many toasts fire in succession. Errors and success with URLs can
    // pass an explicit duration (e.g. 6000) if they need more time.
    const duration = typeof durationMs === "number" && durationMs > 0 ? durationMs : 4000;
    setTimeout(() => set({ message: null }), duration);
  },
  dismiss() {
    set({ message: null });
  }
}));