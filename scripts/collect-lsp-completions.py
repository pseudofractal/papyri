import json
import os
import pathlib
import queue
import subprocess
import tempfile
import threading
import time

output_directory = pathlib.Path("docs/lsp-completions")
capabilities = {
    "textDocument": {
        "completion": {
            "completionItem": {
                "snippetSupport": True,
                "documentationFormat": ["markdown", "plaintext"],
                "insertReplaceSupport": False,
            },
            "completionList": {
                "itemDefaults": ["commitCharacters", "editRange", "insertTextFormat"]
            },
            "completionItemKind": {"valueSet": []},
            "contextSupport": True,
        }
    }
}


def collect(name, cmd, root, cases):
    process = subprocess.Popen(cmd, stdin=subprocess.PIPE, stdout=subprocess.PIPE)
    try:
        messages = queue.Queue()

        def reader():
            while True:
                headers = {}
                while True:
                    line = process.stdout.readline()
                    if not line:
                        return
                    if line in (b"\r\n", b"\n"):
                        break
                    key, value = line.decode().split(":", 1)
                    headers[key.lower()] = value.strip()
                messages.put(
                    json.loads(process.stdout.read(int(headers["content-length"])))
                )

        threading.Thread(target=reader, daemon=True).start()

        def send(message):
            raw = json.dumps(message).encode()
            process.stdin.write(
                b"Content-Length: " + str(len(raw)).encode() + b"\r\n\r\n" + raw
            )
            process.stdin.flush()

        def request(request_id, method, params):
            send(
                {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}
            )

        def receive(request_id):
            deadline = time.monotonic() + 20
            while True:
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    raise TimeoutError(f"{name}: request {request_id}")
                message = messages.get(timeout=remaining)
                if message.get("id") == request_id and "method" not in message:
                    if "error" in message:
                        raise RuntimeError(message["error"])
                    return message["result"]
                if "id" in message and "method" in message:
                    send({"jsonrpc": "2.0", "id": message["id"], "result": None})

        init = {
            "processId": os.getpid(),
            "rootUri": root.as_uri(),
            "capabilities": capabilities,
            "workspaceFolders": [{"uri": root.as_uri(), "name": "examples"}],
        }
        request(1, "initialize", init)
        info = receive(1)
        send({"jsonrpc": "2.0", "method": "initialized", "params": {}})
        responses = []
        for i, (filename, language, text) in enumerate(cases, 2):
            path = root / f"{i}-{filename}"
            path.write_text(text)
            uri = path.as_uri()
            send(
                {
                    "jsonrpc": "2.0",
                    "method": "textDocument/didOpen",
                    "params": {
                        "textDocument": {
                            "uri": uri,
                            "languageId": language,
                            "version": 1,
                            "text": text,
                        }
                    },
                }
            )
            params = {
                "textDocument": {"uri": uri},
                "position": {
                    "line": text.count("\n"),
                    "character": len(text.split("\n")[-1]),
                },
                "context": {"triggerKind": 1},
            }
            request(i, "textDocument/completion", params)
            result = receive(i)
            resolved = []
            if name == "texlab" and text.endswith("\\cite{"):
                for index, item in enumerate(result.get("items", [])):
                    request(1000 + index, "completionItem/resolve", item)
                    resolved.append(receive(1000 + index))
            responses.append(
                {
                    "input": text,
                    "filename": path.name,
                    "result": result,
                    **({"resolved": resolved} if resolved else {}),
                }
            )
            send(
                {
                    "jsonrpc": "2.0",
                    "method": "textDocument/didClose",
                    "params": {"textDocument": {"uri": uri}},
                }
            )
            items = (
                result.get("items", []) if isinstance(result, dict) else result or []
            )
            print(name, filename, repr(text.split("\n")[-1]), len(items), flush=True)
        (output_directory / (name + ".json")).write_text(
            json.dumps(
                {
                    "server": name,
                    "serverInfo": info.get("serverInfo"),
                    "completionProvider": info["capabilities"].get(
                        "completionProvider"
                    ),
                    "cases": responses,
                },
                ensure_ascii=False,
                indent=2,
            ).replace(str(root), "/sample-workspace")
            + "\n"
        )
    finally:
        process.terminate()
        process.wait(timeout=5)


with tempfile.TemporaryDirectory(prefix="papyri-lsp-corpus-") as directory:
    root = pathlib.Path(directory)
    typst = [
        ("example.typ", "typst", text)
        for text in [
            "#",
            "#rect(",
            "#text(",
            "#page(",
            "#image(",
            "#table(",
            "#figure(",
            "#grid(",
            "#set text(",
            "#set page(",
            "#rgb(",
            "#str(",
            "#array(",
            "#dict(",
            "#math.",
            "#color.",
            "#sym.",
            "#array.",
            "#str.",
            "#calc.",
            "#datetime.",
            "#duration.",
            "#sys.",
            "#std.",
            "#gradient.",
            "#regex.",
            "#line(",
            "#rotate(",
            "#block(",
            "#place(",
            "#link(",
        ]
    ]
    for i in range(60):
        (root / f"module-{i:02}.typ").write_text(f"#let item = {i}\n")
        (root / f"image-{i:02}.svg").write_text('<svg xmlns="http://www.w3.org/2000/svg"/>\n')
    imports = "\n".join(
        f'#import "module-{i:02}.typ" as module{i:02}' for i in range(60)
    )
    typst.extend(
        ("example.typ", "typst", text)
        for text in ['#image("', '#read("', imports + "\n#module"]
    )
    collect("tinymist", ["tinymist"], root, typst)
    for i in range(60):
        (root / f"chapter-{i:02}.tex").write_text("Example.\n")
    bib = "".join(
        f"@article{{ref{i:02}, title={{Example title {i:02}}}, author={{Author, Alice}}, year={{2020}}}}\n"
        for i in range(60)
    )
    (root / "references.bib").write_text(bib)
    tex = [
        ("example.tex", "latex", text)
        for text in [
            "\\documentclass{article}\n\\begin{document}\n\\input{",
            "\\documentclass{article}\n\\bibliography{references}\n\\begin{document}\n\\cite{",
            "\\documentclass{article}\n\\begin{document}\n"
            + "".join(
                f"\\section{{Topic {i:02}}}\\label{{sec:topic{i:02}}}\n"
                for i in range(60)
            )
            + "\\ref{",
            "\\documentclass{article}\n\\begin{document}\n\\sec",
        ]
    ]
    collect("texlab", ["texlab"], root, tex)
    for i in range(60):
        (root / f"research-{i:02}.md").write_text("# Notes\n")
    headings = "\n\n".join(f"## Research topic {i:02}" for i in range(60))
    markdown = [
        ("notes.md", "markdown", headings + "\n\n[notes](#re"),
        ("notes.md", "markdown", headings + "\n\n[[research-"),
        ("notes.md", "markdown", headings + "\n\n[link](research-"),
    ]
    collect("marksman", ["marksman", "server"], root, markdown)
