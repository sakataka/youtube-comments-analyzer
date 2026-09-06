"""Public subtitles only; no cookies, login extraction or media download."""
from __future__ import annotations

import html
import json
import re
import shutil
import subprocess
import tempfile
from pathlib import Path
from typing import Any


def parse_subtitles(text: str) -> list[dict[str, Any]]:
    segments = []
    if text.lstrip().startswith('{'):
        payload = json.loads(text)
        for event in payload.get('events', []):
            content = ''.join(part.get('utf8', '') for part in event.get('segs', [])).strip()
            if content:
                start = float(event.get('tStartMs', 0)) / 1000
                segments.append({'start': start, 'end': start + float(event.get('dDurationMs', 0)) / 1000, 'text': content})
    else:
        pattern = r'(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{3})'
        for block in re.split(r'\n\s*\n', text.replace('\r\n', '\n')):
            lines = block.splitlines()
            timing = next((i for i, line in enumerate(lines) if '-->' in line), None)
            if timing is None:
                continue
            times = re.findall(pattern, lines[timing])
            if len(times) != 2:
                continue
            values = [int(h or 0) * 3600 + int(m) * 60 + int(s) + int(ms) / 1000 for h, m, s, ms in times]
            content = html.unescape(re.sub(r'<[^>]+>', '', '\n'.join(lines[timing + 1:]))).strip()
            if content and values[1] >= values[0]:
                segments.append({'start': values[0], 'end': values[1], 'text': content})
    if not segments:
        raise ValueError('時刻付きのVTT・SRT・YouTube JSON3字幕を読み取れませんでした。')
    # Keep original timing and text, including overlapping automatic caption windows.
    return [dict(segment, id=f's{i}') for i, segment in enumerate(segments)]


def fetch_transcript(url: str) -> dict[str, Any]:
    executable = shutil.which('yt-dlp') or '/opt/homebrew/bin/yt-dlp'
    if not Path(executable).exists():
        return {'status': 'unavailable', 'reason': 'yt-dlpが見つかりません。字幕ファイルを取り込めます。', 'segments': []}
    try:
        info = subprocess.run([executable, '--ignore-config', '--dump-single-json', '--skip-download', '--no-playlist', '--socket-timeout', '20', '--', url], capture_output=True, text=True, timeout=75, check=True)
        metadata = json.loads(info.stdout)
        candidates = []
        for source, automatic in [('subtitles', False), ('automatic_captions', True)]:
            for language, formats in (metadata.get(source) or {}).items():
                usable = [item for item in formats if item.get('ext') in ('vtt', 'json3') and 'tlang=' not in item.get('url', '')]
                if usable and language != 'live_chat':
                    rank = 0 if language.startswith('ja') else 1 if language.startswith('en') else 2
                    candidates.append((rank, automatic, language))
        if not candidates:
            return {'status': 'unavailable', 'reason': '取得可能な原語字幕がありません。', 'segments': []}
        _, automatic, language = sorted(candidates)[0]
        with tempfile.TemporaryDirectory(prefix='comments-subtitles-') as directory:
            subprocess.run([executable, '--ignore-config', '--skip-download', '--no-playlist', '--write-auto-subs' if automatic else '--write-subs', '--sub-langs', re.escape(language), '--sub-format', 'vtt/json3', '--socket-timeout', '20', '-o', str(Path(directory) / 'captions.%(ext)s'), '--', url], capture_output=True, text=True, timeout=75, check=True)
            files = [p for p in Path(directory).iterdir() if p.suffix in ('.vtt', '.json3')]
            if not files:
                raise ValueError('字幕本文を取得できませんでした。')
            segments = parse_subtitles(files[0].read_text())
        return {'status': 'available', 'source': 'yt-dlp', 'language': language, 'automatic': automatic, 'segments': segments}
    except (subprocess.SubprocessError, OSError, ValueError):
        return {'status': 'unavailable', 'reason': '字幕取得に失敗しました。字幕なしで続行します。ファイル取り込みも利用できます。', 'segments': []}
