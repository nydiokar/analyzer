"use client";

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-3xl font-bold">Something went wrong</h1>
      <button
        className="rounded bg-primary px-4 py-2 text-white hover:bg-primary/80"
        onClick={() => reset()}
      >
        Try Again
      </button>
    </div>
  );
} 