"""Tests du serveur local et de ses garde-fous pour les données GPS."""

import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from app import Handler


class LocalRequestTests(unittest.TestCase):
    def allowed(self, headers):
        request = SimpleNamespace(headers=headers, send_error=Mock())
        result = Handler.local_request(request)
        if not result:
            request.send_error.assert_called_once()
            self.assertEqual(request.send_error.call_args.args[0], 403)
        else:
            request.send_error.assert_not_called()
        return result

    def test_local_browser_and_command_line_are_allowed(self):
        self.assertTrue(self.allowed({"Host": "127.0.0.1:8765"}))
        self.assertTrue(self.allowed({"Host": "localhost:8765", "Sec-Fetch-Site": "same-origin"}))
        self.assertTrue(self.allowed({"Host": "127.0.0.1:8765",
                                      "Origin": "http://127.0.0.1:8765"}))

    def test_foreign_hosts_and_origins_are_rejected(self):
        for headers in ({"Host": "attacker.example:8765"},
                        {"Host": "127.0.0.1:8765", "Origin": "https://attacker.example"},
                        {"Host": "127.0.0.1:8765", "Sec-Fetch-Site": "cross-site"}):
            with self.subTest(headers=headers):
                self.assertFalse(self.allowed(headers))
