from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from ._tool_test_harness import build_env, run_tool


class MarkitdownSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.env = build_env()
        cls.tmpdir_obj = tempfile.TemporaryDirectory(prefix="markitdown-smoke-")
        cls.tmpdir = Path(cls.tmpdir_obj.name)

    @classmethod
    def tearDownClass(cls) -> None:
        cls.tmpdir_obj.cleanup()

    def run_markitdown(self, *args: str):
        return run_tool("markitdown", *args, env=self.env)

    def test_plain_text_passthrough(self) -> None:
        txt = self.tmpdir / "plain.txt"
        txt.write_text("hello craft", encoding="utf-8")

        result = self.run_markitdown(str(txt))
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertIn("hello craft", result.stdout)

    def test_docx_fallback_path(self) -> None:
        docx = self.tmpdir / "sample.docx"
        with ZipFile(docx, "w", ZIP_DEFLATED) as archive:
            archive.writestr(
                "[Content_Types].xml",
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
                '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
                '<Default Extension="xml" ContentType="application/xml"/>'
                '<Override PartName="/word/document.xml" '
                'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
                '</Types>',
            )
            archive.writestr(
                "_rels/.rels",
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
                '<Relationship Id="rId1" '
                'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
                'Target="word/document.xml"/>'
                '</Relationships>',
            )
            archive.writestr(
                "word/document.xml",
                '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
                '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
                '<w:body><w:p><w:r><w:t>Hello from docx</w:t></w:r></w:p><w:sectPr/></w:body>'
                '</w:document>',
            )

        result = self.run_markitdown(str(docx))
        self.assertEqual(result.returncode, 0, msg=result.stderr)
        self.assertIn("Hello from docx", result.stdout)


if __name__ == "__main__":
    unittest.main()
