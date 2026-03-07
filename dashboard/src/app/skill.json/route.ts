import { readFileSync } from 'fs';
import { join } from 'path';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET() {
  const filePath = join(process.cwd(), '..', 'documentation', 'agent-skill', 'skill.json');
  const content = readFileSync(filePath, 'utf-8');

  return new NextResponse(content, {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
