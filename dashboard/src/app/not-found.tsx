"use client";

export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background p-8 text-center text-foreground">
      <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
        404 – Page Not Found
      </h1>
      <p className="max-w-md text-base text-muted-foreground">
        Sorry, we couldn&#39;t find the page you&#39;re looking for.
      </p>
    </div>
  );
} 