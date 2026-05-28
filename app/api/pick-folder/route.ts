import { execFileSync } from 'child_process';
import { NextResponse } from 'next/server';

export async function GET() {
  if (process.platform !== 'darwin') {
    return NextResponse.json(
      { error: 'Folder picker only supported on macOS' },
      { status: 501 },
    );
  }
  try {
    const raw = execFileSync(
      'osascript',
      ['-e', 'POSIX path of (choose folder with prompt "Select output folder:")'],
      { timeout: 60_000, encoding: 'utf8' },
    ).trim();
    // osascript appends a trailing slash — normalise it away
    const folderPath = raw.endsWith('/') ? raw.slice(0, -1) : raw;
    return NextResponse.json({ folderPath });
  } catch {
    // Exit code 1 = user cancelled the dialog; also covers osascript unavailable
    return NextResponse.json({ cancelled: true });
  }
}
