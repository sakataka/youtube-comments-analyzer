"""Each E2E server owns an empty temporary DB; never accesses the user's DB."""
import os
import tempfile
from pathlib import Path
import uvicorn

fixture_directory = tempfile.TemporaryDirectory(prefix='comments-e2e-isolated-')
os.environ['DATA_DIR'] = fixture_directory.name
os.environ['DATABASE_URL'] = str(Path(fixture_directory.name) / 'test.sqlite3')
os.environ['YOUTUBE_API_KEY'] = ''
os.environ['YOUTUBE_FIXTURE_FALLBACK'] = '1'

from backend.app.main import app, opinion_store
from backend.tests.opinion_fakes import FakeOpinionClient

original = opinion_store.process

def fixture_process(run_id, youtube, progress):
    return original(run_id, youtube, progress, client=FakeOpinionClient())

opinion_store.process = fixture_process
if __name__ == '__main__':
    try:
        uvicorn.run(app, host='127.0.0.1', port=8011)
    finally:
        opinion_store.conn.close()
        fixture_directory.cleanup()
