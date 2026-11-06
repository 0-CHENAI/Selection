"""Independent, offline audit of real Selection benchmark artifacts (stdlib only).
Usage: python3 scripts/office-word-benchmark-audit.py RESULTS_DIRECTORY
Does not invoke the agent or add any production QA steps.
"""
import collections
import hashlib
import json
import re
import statistics
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

W = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
def normalize(text):
    return re.sub(r"\s+", "", text)

def paragraphs(root):
    return [
        "".join(t.text or "" for t in p.iter(W + "t")) for p in root.iter(W + "p")
    ]

def xml_signature(data):
    def visit(node):
        text = node.text or ""
        if node.tag not in (W + "t", W + "instrText") and not text.strip():
            text = ""
        attrs = tuple(sorted((k, v) for k, v in node.attrib.items()
                             if not k.startswith(W + "rsid") and k not in (
                                 "{http://schemas.microsoft.com/office/word/2010/wordml}paraId",
                                 "{http://schemas.microsoft.com/office/word/2010/wordml}textId")))
        return (node.tag, attrs, text, tuple(visit(c) for c in node))
    return visit(ET.fromstring(data))

def audit(path):
    data = json.loads(path.read_text())
    directory = path.parent
    source = (directory / "source.txt").read_text()
    lines = [normalize(line) for line in source.splitlines() if normalize(line)]
    file = directory / "report.docx"
    result = {"phase": data["phase"], "trial": data["trial"], "sessionId": data["sessionId"],
              "elapsedSeconds": round(data["elapsedMs"] / 1000, 3), "tools": len(data["tools"]),
              "fixtureSha256": data["fixtureSha256"], "error": data.get("error"),
              "delivered": file.exists() and "report.docx" in (data.get("final") or "")}
    writes = []
    source_checked_writes = 0
    for i, tool in enumerate(data["tools"]):
        if tool["name"].endswith("office_template_write"):
            try:
                value = json.loads(tool.get("result") or "{}")
            except (ValueError, TypeError):
                continue
            if value.get("status") == "ready":
                writes.append((i, tool))
                if value.get("content_check", {}).get("source_sha256") == data["fixtureSha256"]:
                    source_checked_writes += 1
    result["successfulWrites"] = len(writes)
    result["sourceCheckedWrites"] = source_checked_writes
    if writes:
        index, tool = writes[0]
        result["toolsAfterFirstSuccess"] = len(data["tools"]) - index - 1
        # Tool timestamp is start time, so this is an upper bound including write duration.
        result["secondsAfterFirstWriteStart"] = round((data["completed"] - tool["at"]) / 1000, 3)
    if not file.exists():
        return result
    result["artifactSha256"] = hashlib.sha256(file.read_bytes()).hexdigest()
    with zipfile.ZipFile(file) as output:
        root = ET.fromstring(output.read("word/document.xml"))
        ps = paragraphs(root)
        text = normalize("\n".join(ps))
        missing = [line for line, count in collections.Counter(lines).items() if text.count(line) < count]
        result["sourceLines"] = len(lines)
        result["missingLines"] = missing
        result["sourceCoveragePassed"] = not missing
        cursor = 0
        for line in lines:
            found = text.find(line, cursor)
            if found < 0:
                break
            cursor = found + len(line)
        else:
            result["sourceOrderPassed"] = True
        result.setdefault("sourceOrderPassed", False)
        tables = root.findall(".//" + W + "tbl")
        result["tables"] = [[len(row.findall(W + "tc")) for row in table.findall(W + "tr")] for table in tables]
        # This fixed fixture's comparison table starts with 项目 and ends before its conclusion.
        raw = source.splitlines()
        start = raw.index("项目")
        end = next(i for i, line in enumerate(raw) if line.startswith("把六类摊开看"))
        expected_cells = [normalize(line) for line in raw[start:end] if normalize(line)]
        actual_cells = [normalize("".join(paragraphs(cell))) for table in tables for row in table.findall(W + "tr") for cell in row.findall(W + "tc")]
        result["comparisonTablePassed"] = actual_cells == expected_cells
        template = Path(data["assets"]) / "resources/skills/office-business/cases/style-system-design/example.docx"
        with zipfile.ZipFile(template) as original:
            result["templateStyleBytesUnchanged"] = output.read("word/styles.xml") == original.read("word/styles.xml")
            result["templateStylesUnchanged"] = xml_signature(output.read("word/styles.xml")) == xml_signature(original.read("word/styles.xml"))
            result["templateFooterBytesUnchanged"] = output.read("word/footer1.xml") == original.read("word/footer1.xml")
            result["templateFooterUnchanged"] = xml_signature(output.read("word/footer1.xml")) == xml_signature(original.read("word/footer1.xml"))
    return result

root = Path(sys.argv[1])
trials = [audit(p) for p in sorted(root.glob("*-*/measurement.json"))]
phases = {}
for phase in sorted({t["phase"] for t in trials}):
    items = [t for t in trials if t["phase"] == phase]
    phases[phase] = {"trials": len(items), "medianSeconds": statistics.median(t["elapsedSeconds"] for t in items),
                     "medianTools": statistics.median(t["tools"] for t in items),
                     "allPassed": all(all(t.get(k) for k in ["delivered", "sourceCoveragePassed", "sourceOrderPassed", "comparisonTablePassed", "templateStylesUnchanged", "templateFooterUnchanged"]) for t in items)}
print(json.dumps({"phases": phases, "trials": trials}, ensure_ascii=False, indent=2))
