import unittest

from backend.app.youtube import YouTubeUrlError, parse_youtube_video_id


class YouTubeUrlParsingTest(unittest.TestCase):
    def test_supported_urls(self):
        urls = [
            "https://www.youtube.com/watch?v=vlpLbiqNhLo",
            "https://youtu.be/vlpLbiqNhLo",
            "https://www.youtube.com/shorts/vlpLbiqNhLo",
            "https://www.youtube.com/embed/vlpLbiqNhLo",
            "https://www.youtube.com/watch?v=vlpLbiqNhLo&t=10s",
            "https://www.youtube.com/watch?v=vlpLbiqNhLo&list=abc",
        ]
        for url in urls:
            with self.subTest(url=url):
                self.assertEqual(parse_youtube_video_id(url), "vlpLbiqNhLo")

    def test_rejects_invalid_urls(self):
        for url in ["https://www.youtube.com/playlist?list=abc", "not a url", "https://example.com/watch?v=vlpLbiqNhLo"]:
            with self.subTest(url=url):
                with self.assertRaises(YouTubeUrlError):
                    parse_youtube_video_id(url)


if __name__ == "__main__":
    unittest.main()
