"""Exercise the actual Linux WebKit app through Tauri's maintained WebDriver.

Run under xvfb-run with tauri-driver and WebKitWebDriver on PATH.
PAPYRI_BINARY selects a built release binary. Fixtures are temporary.
"""
import json
import base64
import os
import signal
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:4444"


class WebDriverError(AssertionError):
    pass


def request(method, path, data=None):
    body = None if data is None else json.dumps(data).encode()
    req = urllib.request.Request(BASE + path, body, {"Content-Type": "application/json"}, method=method)
    try:
        with urllib.request.urlopen(req, timeout=40) as response:
            result = json.load(response)
    except urllib.error.HTTPError as error:
        raise WebDriverError(error.read().decode()) from error
    if isinstance(result.get("value"), dict) and "error" in result["value"]:
        raise AssertionError(result)
    return result.get("value")


def until(check, description, seconds=25):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            value = check()
            if value:
                return value
        except WebDriverError as error:
            if not any(message in str(error) for message in ("no such window", "no such frame", "stale element reference")):
                raise
        except (ConnectionError, urllib.error.URLError):
            pass
        time.sleep(0.2)
    raise AssertionError("Timed out: " + description)


with tempfile.TemporaryDirectory(prefix="papyri-native-") as directory:
    root = Path(directory)
    document = root / "hello world.md"
    (root / "sub").mkdir()
    (root / "pixel.png").write_bytes(base64.b64decode("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1kAAAAASUVORK5CYII="))
    body = "\n\n[Next](./sub/next.md)\n\n![Local pixel](./pixel.png)\n\n```mermaid\nflowchart LR\nA --> B\n```\n\n```dot\ndigraph { A -> B; }\n```\n\n" + "A paragraph.\n\n" * 150
    equation = r"[ \begin{bmatrix}Y_a&I\ O&J_R\end{bmatrix} \begin{bmatrix}\mathbf A\\mathbf B\end{bmatrix}" + "\n\n" + r"\begin{bmatrix}\kappa^2\mathbf e_0\\mathbf0\end{bmatrix}. \tag{7} ]"
    wide_matrix = r"\( \begin{bmatrix}" + " & ".join("x_{" + str(index) + "}" for index in range(60)) + r"\end{bmatrix} \)"
    body = "\n\nSee (7) and [1].\n\n" + wide_matrix + body + "\n\n" + equation + "\n\n## References\n\n[1] Example reference."
    body += "\n\n~~~sh\ncommand --input " + "models/geometry/" * 30 + "input.json\n~~~"
    body += '\n\nNeedle in prose.\n\n<svg id="search-regression" xmlns="http://www.w3.org/2000/svg" width="300" height="80"><text x="5" y="40">Needle</text></svg>\n\n```json\n{"property": 1}\n```\n\n## Equation 7\n\n## Reference 1'
    body = "\n\n[Self](./hello%20world.md)" + body
    document.write_text("# Native works" + body)
    (root / "sub" / "next.md").write_text("# Linked document\n\n[Back](../hello%20world.md)")
    (root / ".hidden.md").write_text("# Hidden")
    (root / "paper.pdf").write_bytes(Path("e2e/fixtures/paged.pdf").read_bytes())
    (root / "paper.typ").write_text('= Native Typst\n#include "part.typ"')
    (root / "part.typ").write_text("Imported dependency")
    log = open("/tmp/papyri-native-driver.log", "w")
    test_environment = {
        **os.environ,
        "XDG_DATA_HOME": str(root / "app-data"),
        "XDG_CONFIG_HOME": str(root / "config"),
        "XDG_CACHE_HOME": str(root / "cache"),
        "PAPYRI_CONTROL_SOCKET": str(root / "control.sock"),
    }
    driver = subprocess.Popen(["tauri-driver"], stdout=log, stderr=log, env=test_environment, start_new_session=True)
    session = None
    detached_log = None
    detached_socket = None
    try:
        until(lambda: request("GET", "/status"), "WebDriver startup")
        binary = os.environ.get("PAPYRI_BINARY") or str(Path("src-tauri/target/debug/papyri").resolve())
        options = {"capabilities": {"alwaysMatch": {"tauri:options": {"application": binary, "args": ["--decorationless", "--log", "terminal", str(root) + "/sub/../hello world.md"]}}}}
        session = request("POST", "/session", options)["sessionId"]
        prefix = "/session/" + session
        until(lambda: request("GET", prefix + "/title") == "Papyri", "Papyri window title")
        request("POST", prefix + "/window/rect", {"width": 1280, "height": 860})

        def execute(script):
            return request("POST", prefix + "/execute/sync", {"script": script, "args": []})

        def asynchronous(script):
            return request("POST", prefix + "/execute/async", {"script": script, "args": []})

        def keyboard(*keys):
            actions = [{"type": "keyDown", "value": key} for key in keys]
            actions += [{"type": "keyUp", "value": key} for key in reversed(keys)]
            request("POST", prefix + "/actions", {"actions": [{"type": "key", "id": "keyboard", "actions": actions}]})

        def control(*arguments):
            result = subprocess.run(
                [binary, "ctl", *arguments],
                capture_output=True,
                text=True,
                env=test_environment,
                timeout=90,
            )
            if result.returncode != 0:
                raise AssertionError(result.stderr.strip() or f"papyri ctl {' '.join(arguments)} failed")
            return result.stdout

        def frame(index=0):
            request("POST", prefix + "/frame", {"id": None})
            until(lambda: execute("return document.querySelectorAll('iframe:not(.pending)').length>" + str(index)), "preview frame readiness")
            elements = request("POST", prefix + "/elements", {"using": "css selector", "value": "iframe"})
            request("POST", prefix + "/frame", {"id": elements[index]})

        def preview(script):
            frame()
            return execute(script)

        def assert_dialog_layout():
            def bounds_fit():
                return execute("const p=document.querySelector('dialog[open] .modal-box'),r=p.getBoundingClientRect(),v=visualViewport,w=Math.min(innerWidth,v.width),h=Math.min(innerHeight,v.height);return Math.abs(r.width-w*.75)<=2&&r.height<=h*.8+2&&r.left>=v.offsetLeft+w*.125-2&&r.right<=v.offsetLeft+w*.875+2&&r.top>=v.offsetTop+h*.1-2&&r.bottom<=v.offsetTop+h*.9+2&&p.scrollWidth<=p.clientWidth+1")

            until(bounds_fit, "dialog within 75% width and 80% height, with no horizontal overflow")

        until(lambda: execute("return !!document.querySelector('iframe')"), "native iframe")
        until(
            lambda: execute("return document.querySelector('.app-shell')?.classList.contains('decorationless')"),
            "CLI decoration-less startup",
        )
        until(
            lambda: execute("const hidden=s=>getComputedStyle(document.querySelector(s)).display==='none';const pane=document.querySelector('.preview-pane');return hidden('.app-header')&&hidden('.tab-bar')&&pane&&Math.abs(pane.getBoundingClientRect().height-innerHeight)<=2"),
            "CLI decoration-less viewport",
        )
        control("ping", "--wait", "10")
        control("decorationless", "off")
        until(
            lambda: execute("return getComputedStyle(document.querySelector('.app-header')).display!=='none'"),
            "CLI decoration-less mode off",
        )
        assert execute("return getComputedStyle(document.querySelector('.brand-mark .app-logo')).maskImage !== 'none'")
        execute("document.querySelector('.brand').style.color='rgb(35, 150, 120)'")
        assert execute("return getComputedStyle(document.querySelector('.brand-mark .app-logo')).backgroundColor") == "rgb(35, 150, 120)"
        execute("document.querySelector('.brand').style.removeProperty('color')")
        frame()
        until(lambda: preview("return document.querySelector('h1')?.textContent === 'Native works'"), "native Markdown render")
        execute("document.documentElement.dataset.session='preserved'")
        original_theme = execute("return document.documentElement.dataset.theme")
        request("POST", prefix + "/frame", {"id": None})
        execute("document.querySelector('[aria-label=\"Toggle color theme\"]').click()")
        until(lambda: preview("return document.documentElement.dataset.theme !== " + json.dumps(original_theme)), "native document theme update")
        assert execute("return document.documentElement.dataset.session") == "preserved"
        expected_color = "rgb(76, 79, 105)" if original_theme == "mocha" else "rgb(205, 214, 244)"
        assert execute("return getComputedStyle(document.documentElement).color") == expected_color
        expected_token = "rgb(159, 75, 10)" if original_theme == "mocha" else "rgb(250, 179, 135)"
        assert execute("return getComputedStyle(document.querySelector('.hljs-attr')).color") == expected_token
        execute("window.__svgBeforeSearch=document.querySelector('#search-regression').innerHTML")
        request("POST", prefix + "/frame", {"id": None})
        assert execute("return document.querySelector('.document-path strong').title") == str(document)
        execute("""
          window.__selfNavigation = false;
          window.addEventListener('message', function observe(event) {
            if (event.source === document.querySelector('iframe').contentWindow &&
                event.data?.type === 'navigate' && event.data.href === './hello%20world.md') {
              window.__selfNavigation = true;
              window.removeEventListener('message', observe);
            }
          });
        """)
        frame()
        execute("document.querySelector('a[href=\"./hello%20world.md\"]').click()")
        request("POST", prefix + "/frame", {"id": None})
        until(lambda: execute("return window.__selfNavigation"), "normalized CLI self-link navigation")
        assert execute("return document.querySelectorAll('.tab-select').length") == 1
        execute("document.querySelector('[aria-label=\"Search document\"]').click()")
        execute("""
          const input = document.querySelector('[aria-label="Find in document"]');
          input.value = 'Needle';
          input.dispatchEvent(new Event('input', { bubbles: true }));
        """)
        until(lambda: preview("return document.querySelectorAll('mark[data-search]').length === 1"), "native prose search")
        assert execute("""
          const svg = document.querySelector('#search-regression');
          return svg.innerHTML === window.__svgBeforeSearch && svg.querySelector('text').getBBox().width > 0;
        """)
        request("POST", prefix + "/frame", {"id": None})
        execute("document.querySelector('[aria-label=\"Close search\"]').click()")
        until(lambda: preview("return !document.querySelector('mark[data-search]')"), "native search cleared")
        request("POST", prefix + "/frame", {"id": None})
        execute("document.querySelector('[aria-label=\"Settings\"]').click()")
        expected_background = "rgb(239, 241, 245)" if original_theme == "mocha" else "rgb(30, 30, 46)"
        until(lambda: execute("return getComputedStyle(document.querySelector('.settings-panel')).backgroundColor") == expected_background, "native themed settings")
        assert execute("return getComputedStyle(document.querySelector('.settings-panel')).color") == expected_color
        execute("document.querySelector('#settings-tab-reading').click()")
        until(lambda: execute("return !document.querySelector('#settings-panel-reading').hidden"), "native settings reading tab")
        execute("const values=[['Markdown text font','serif'],['Math font','STIX Two Math, serif']];for(const [label,value] of values){const input=document.querySelector(`[aria-label=\"${label}\"]`);input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}))}")
        until(lambda: preview("return getComputedStyle(document.body).fontFamily.includes('serif')"), "native Markdown font")
        until(lambda: preview("return getComputedStyle(document.querySelector('.katex')).fontFamily.includes('STIX Two Math')"), "native math font")
        request("POST", prefix + "/frame", {"id": None})
        execute("const values=[['Markdown text font','system-ui, sans-serif'],['Math font','']];for(const [label,value] of values){const input=document.querySelector(`[aria-label=\"${label}\"]`);input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}))}")
        until(lambda: preview("return getComputedStyle(document.body).fontFamily.includes('system-ui')"), "native Markdown font reset")
        request("POST", prefix + "/frame", {"id": None})
        execute("document.querySelector('#settings-tab-appearance').click()")
        for width, height in [(1280, 860), (640, 480), (390, 640)]:
            request("POST", prefix + "/window/rect", {"width": width, "height": height})
            for zoom in [50, 100, 140, 200]:
                execute("window.dispatchEvent(new KeyboardEvent('keydown',{key:'0',ctrlKey:true,altKey:true}));for(let i=0;i<" + str(abs(zoom-100)//10) + ";i++)window.dispatchEvent(new KeyboardEvent('keydown',{key:" + json.dumps('-' if zoom<100 else '+') + ",ctrlKey:true,altKey:true}))")
                until(lambda: execute("return Number(document.documentElement.style.zoom)===" + str(zoom/100)), "dialog UI zoom applied")
                assert_dialog_layout()
                execute("const p=document.querySelector('.settings-panel');p.scrollTop=p.scrollHeight")
                assert execute("const p=document.querySelector('.settings-panel').getBoundingClientRect(),b=document.querySelector('.settings-panel footer button').getBoundingClientRect();return b.top>=p.top&&b.bottom<=p.bottom")
                execute("document.querySelector('.settings-panel').scrollTop=0")
                assert execute("const p=document.querySelector('.settings-panel').getBoundingClientRect(),b=document.querySelector('[aria-label=\"Close settings\"]').getBoundingClientRect();return b.top>=p.top&&b.bottom<=p.bottom")
        request("POST", prefix + "/window/rect", {"width": 1280, "height": 860})
        execute("window.dispatchEvent(new KeyboardEvent('keydown',{key:'0',ctrlKey:true,altKey:true}))")
        execute("for(let i=0;i<4;i++)window.dispatchEvent(new KeyboardEvent('keydown',{key:'+',ctrlKey:true,altKey:true}))")
        assert_dialog_layout()
        close_settings = request("POST", prefix + "/element", {"using": "css selector", "value": "[aria-label=\"Close settings\"]"})
        request("POST", prefix + "/element/" + next(iter(close_settings.values())) + "/click", {})
        until(lambda: execute("return !document.querySelector('dialog[open]')"), "physical Close settings at 140% UI zoom")
        execute("window.dispatchEvent(new KeyboardEvent('keydown',{key:'0',ctrlKey:true,altKey:true}))")
        for opener, closer in [("Keyboard shortcuts and help", "Close"), ("Safe preview: trust current document for scripts", "Keep safe preview")]:
            execute("document.querySelector('[aria-label=" + json.dumps(opener) + "]').click()")
            until(lambda: execute("return !!document.querySelector('dialog[open]')"), "help or trust dialog opened")
            execute("for(let i=0;i<10;i++)window.dispatchEvent(new KeyboardEvent('keydown',{key:'+',ctrlKey:true,altKey:true}))")
            assert_dialog_layout()
            execute("[...document.querySelectorAll('dialog button')].find(button=>button.textContent.trim()===" + json.dumps(closer) + ").click()")
            execute("window.dispatchEvent(new KeyboardEvent('keydown',{key:'0',ctrlKey:true,altKey:true}))")
        execute("document.querySelector('[aria-label^=\"Reset document zoom\"]').click();document.querySelector('[aria-label=\"Zoom in document\"]').click()")
        until(lambda: preview("return Math.abs(parseFloat(getComputedStyle(document.documentElement).fontSize)-17.6)<0.001"), "native document zoom")
        execute("window.dispatchEvent(new KeyboardEvent('keydown',{key:'+',ctrlKey:true,altKey:true}))")
        request("POST", prefix + "/frame", {"id": None})
        until(lambda: execute("return Math.abs(Number(document.documentElement.style.zoom)-1.1)<0.001"), "native UI zoom shortcut from frame")
        assert preview("return document.documentElement.dataset.session") == "preserved"
        execute("window.dispatchEvent(new KeyboardEvent('keydown',{key:'0',ctrlKey:true,altKey:true}));window.dispatchEvent(new KeyboardEvent('keydown',{key:'0',ctrlKey:true}))")
        request("POST", prefix + "/frame", {"id": None})
        frame()
        initial_layout = execute("return {width:innerWidth,height:document.querySelector('main').getBoundingClientRect().height,scale:visualViewport.scale}")
        keyboard("\ue009", "\ue008", "=")
        until(lambda: execute("return Math.abs(parseFloat(getComputedStyle(document.querySelector('p')).fontSize)-17.6)<0.001"), "physical Ctrl Shift = increases text font size")
        assert execute("return innerWidth") == initial_layout["width"]
        assert execute("return visualViewport.scale") == initial_layout["scale"]
        assert execute("return document.querySelector('main').getBoundingClientRect().height") > initial_layout["height"]
        keyboard("\ue009", "0")
        keyboard("\ue009", "\ue025")
        until(lambda: execute("return Math.abs(parseFloat(getComputedStyle(document.querySelector('p')).fontSize)-17.6)<0.001"), "physical Ctrl numpad + increases text font size")
        keyboard("\ue009", "0")
        execute("window.dispatchEvent(new KeyboardEvent('keydown',{key:'Unidentified',code:'Equal',ctrlKey:true,shiftKey:true,cancelable:true}))")
        until(lambda: execute("return Math.abs(parseFloat(getComputedStyle(document.querySelector('p')).fontSize)-17.6)<0.001"), "WebKit unidentified physical zoom key")
        keyboard("\ue009", "0")
        keyboard("\ue009", "=")
        until(lambda: execute("return document.documentElement.dataset.fitWidth==='true'"), "native fit-to-width shortcut")
        assert execute("return document.documentElement.style.zoom === ''")
        assert execute("return document.documentElement.scrollWidth === document.documentElement.clientWidth")
        assert execute("const math=document.querySelector('.math');return math.scrollWidth>math.clientWidth && math.getBoundingClientRect().right<=document.documentElement.clientWidth")
        def fitted_layout(index=0):
            frame(index)
            return execute("const root=document.documentElement.getBoundingClientRect(),main=document.querySelector('main').getBoundingClientRect();return {viewport:innerWidth,root:root.width,right:main.right,width:main.width}")

        def assert_fitted_layout(index=0):
            def measured_fit():
                layout = fitted_layout(index)
                return layout if abs(layout["width"]-layout["viewport"])<=1 else False

            try:
                layout = until(measured_fit, "document fits actual frame viewport")
            except AssertionError:
                print("Native viewport mismatch:", execute("return {inner:innerWidth,visual:visualViewport.width,scale:visualViewport.scale,client:document.documentElement.clientWidth,root:document.documentElement.getBoundingClientRect().width,main:document.querySelector('main').getBoundingClientRect().width,fit:document.documentElement.dataset.fitWidth,vars:document.documentElement.style.cssText}"), flush=True)
                raise
            assert layout["right"] <= layout["viewport"] + 1, layout
            assert layout["root"] <= layout["viewport"] + 1, layout
            assert execute("return Math.abs(parseFloat(getComputedStyle(document.documentElement).fontSize)-16)<0.001"), "UI zoom preserves document font size"
            assert execute("return [...document.querySelectorAll('pre')].filter(node=>node.getClientRects().length>0).every(node=>node.scrollWidth<=node.clientWidth+1)"), "fitted code wraps locally"

        # WebKit scales clientWidth and vw by ancestor zoom; neither is a valid oracle.
        for steps in [-5, 1, 5, 10]:
            request("POST", prefix + "/frame", {"id": None})
            execute("window.dispatchEvent(new KeyboardEvent('keydown',{key:'0',ctrlKey:true,altKey:true}))")
            for _ in range(abs(steps)):
                execute("window.dispatchEvent(new KeyboardEvent('keydown',{key:'" + ("-" if steps<0 else "+") + "',ctrlKey:true,altKey:true}))")
            expected_scale = 1 + steps / 10
            until(lambda: execute("return Math.abs(Number(document.documentElement.style.zoom)-" + str(expected_scale) + ")<0.001"), "UI scale applied")
            assert_fitted_layout()
        request("POST", prefix + "/frame", {"id": None})
        for name in ["Toggle table of contents", "Toggle explorer", "Toggle split view"]:
            request("POST", prefix + "/frame", {"id": None})
            execute("document.querySelector('[aria-label=" + json.dumps(name) + "]').click()")
            assert_fitted_layout()
        assert_fitted_layout(1)
        request("POST", prefix + "/frame", {"id": None})
        execute("document.querySelector('[aria-label=\"Toggle split view\"]').click()")
        execute("document.querySelector('[aria-label=\"Toggle explorer\"]').click()")
        execute("window.dispatchEvent(new KeyboardEvent('keydown',{key:'0',ctrlKey:true,altKey:true}))")
        assert_fitted_layout()
        keyboard("\ue009", "=")
        request("POST", prefix + "/frame", {"id": None})
        if not execute("return !!document.querySelector('.sidebar')"):
            execute("document.querySelector('[aria-label=\"Toggle explorer\"]').click()")
        until(lambda: execute("return document.querySelector('.sidebar-resize')?.getBoundingClientRect().width>0"), "explorer divider ready for mouse input")
        divider = execute("const r=document.querySelector('[aria-label=\"Resize explorer\"]').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+120,width:document.querySelector('.sidebar').getBoundingClientRect().width}")
        drag = -60 if divider["width"] > 400 else 60
        request("POST", prefix + "/actions", {"actions": [{"type": "pointer", "id": "mouse", "parameters": {"pointerType": "mouse"}, "actions": [
            {"type": "pointerMove", "duration": 0, "x": round(divider["x"]), "y": round(divider["y"])},
            {"type": "pointerDown", "button": 0},
            {"type": "pointerMove", "duration": 200, "x": round(divider["x"] + drag), "y": round(divider["y"])},
            {"type": "pointerUp", "button": 0}
        ]}]})
        until(lambda: execute("return Math.abs(document.querySelector('.sidebar').getBoundingClientRect().width-" + str(divider["width"]) + ")>40"), "native mouse explorer resizing")
        execute("document.querySelector('[aria-label=\"Resize explorer\"]').dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowRight',bubbles:true}))")
        assert execute("return JSON.parse(localStorage.getItem('papyri.preferences')).sidebarWidth>=180")
        until(lambda: execute("const stored=JSON.parse(localStorage.getItem('papyri.recentFolders')||'null');return !!stored&&stored.folders.some(folder=>folder.path===" + json.dumps(str(root)) + ")"), "native recent folder persistence")
        execute("window.dispatchEvent(new KeyboardEvent('keydown',{key:'k',ctrlKey:true}))")
        until(lambda: execute("return document.querySelector('.palette-group')?.textContent.includes('Recent folders')"), "native recent folders in palette")
        execute("document.querySelector('[aria-label=\"Close command palette\"]').click()")
        until(lambda: execute("return !document.querySelector('[aria-label=\"Close command palette\"]')"), "native recent palette close")
        frame()
        assert execute("return !!document.querySelector('.katex-display') && !!document.querySelector('a[href=\"#equation-7-1\"]') && !!document.querySelector('a[href=\"#reference-1-1\"]')")
        assert execute("const ids=[...document.querySelectorAll('[id]')].map(node=>node.id);return ids.length===new Set(ids).size")
        assert execute("return typeof window.__PAPYRI_HOST_TOKEN__") == "undefined"
        assert execute("try { return parent.__PAPYRI_HOST_TOKEN__ || 'missing' } catch { return 'isolated' }") == "isolated"
        execute("document.querySelector('img').scrollIntoView()")
        assert until(lambda: execute("return document.querySelector('img')?.naturalWidth === 1"), "local image resolution")
        execute("document.querySelector('.image-frame img').click()")
        until(lambda: execute("return !!document.querySelector('.image-dialog[open]')"), "native image viewer")
        request("POST", prefix + "/frame", {"id": None})
        until(lambda: execute("return !!document.querySelector('.preview-pane.expanded')"), "native expanded image frame")
        frame()
        assert execute("return getComputedStyle(document.querySelector('.image-viewport')).backgroundImage.includes('linear-gradient')")
        assert execute("return !!document.querySelector('.image-dialog[open] img')")
        execute("document.querySelector('.image-dialog [aria-label=\"Close image\"]').click()")
        until(lambda: execute("return !document.querySelector('.image-dialog')"), "native image dialog close")
        request("POST", prefix + "/frame", {"id": None})
        until(lambda: execute("return !document.querySelector('.preview-pane.expanded')"), "native image close")
        frame()
        execute("document.querySelector('#search-regression').closest('.image-frame').querySelector('button').click()")
        until(lambda: execute("return !!document.querySelector('.image-dialog[open] svg')"), "native inline SVG viewer")
        request("POST", prefix + "/frame", {"id": None})
        until(lambda: execute("return !!document.querySelector('.preview-pane.expanded')"), "native expanded inline SVG frame")
        frame()
        execute("document.querySelector('.image-dialog [aria-label=\"Close image\"]').click()")
        request("POST", prefix + "/frame", {"id": None})
        until(lambda: execute("return !document.querySelector('.preview-pane.expanded')"), "native inline SVG close")
        frame()
        denial = asynchronous("const done=arguments[arguments.length-1]; const api=window.__TAURI_INTERNALS__; if(!api) done('unavailable'); else api.invoke('read_document',{path:'/etc/passwd',hostToken:'forged'}).then(()=>done('BAD'),()=>done('denied'))")
        assert denial in ("unavailable", "denied")
        execute("document.querySelectorAll('.diagram')[0].querySelector('button').click()")
        until(lambda: execute("return document.querySelectorAll('.diagram svg').length === 1"), "native Mermaid diagram")
        assert execute("""
          const nodes = [...document.querySelectorAll('.diagram svg .node')];
          return nodes.length === 2 && nodes.every(node => node.textContent.trim()) &&
            [...document.querySelectorAll('.diagram svg text')].every(label => label.getBBox().width > 0);
        """)
        for _ in range(5):
            execute("window.dispatchEvent(new KeyboardEvent('keydown',{key:'+',ctrlKey:true,altKey:true}))")
        execute("document.querySelectorAll('.diagram-actions button')[1].click()")
        until(lambda: execute("return !!document.querySelector('.diagram-dialog[open] svg')"), "native expanded diagram")
        request("POST", prefix + "/frame", {"id": None})
        until(lambda: execute("return !!document.querySelector('.preview-pane.expanded')"), "native expanded frame")
        assert execute("const bounds=document.querySelector('iframe').getBoundingClientRect();return Math.abs(bounds.width-innerWidth)<2 && Math.abs(bounds.height-innerHeight)<2")
        frame()
        until(lambda: execute("const bounds=document.querySelector('.diagram-dialog').getBoundingClientRect();return bounds.x>=0&&bounds.y>=0&&bounds.right<=innerWidth+1&&bounds.bottom<=innerHeight+1&&bounds.width<=innerWidth*.75+1&&bounds.height<=innerHeight*.8+1"), "expanded diagram fits 75% width and 80% height of the actual viewport")
        execute("document.querySelector('.diagram-dialog [aria-label=\"Close diagram\"]').click()")
        execute("window.dispatchEvent(new KeyboardEvent('keydown',{key:'0',ctrlKey:true,altKey:true}))")
        until(lambda: execute("return !document.querySelector('.diagram-dialog')"), "native diagram close")
        execute("document.querySelectorAll('.diagram')[1].querySelector('button').click()")
        until(lambda: execute("return document.querySelectorAll('.diagram svg').length === 2"), "native Graphviz WASM diagram")
        request("POST", prefix + "/frame", {"id": None})
        execute("window.__papyriScrollObserved=false;window.addEventListener('message',function observe(event){if(event.source===document.querySelector('iframe').contentWindow&&event.data?.type==='scroll'&&event.data.y>500){window.__papyriScrollObserved=true;window.removeEventListener('message',observe)}})")
        frame()
        execute("window.scrollTo(0, 600)")
        until(lambda: preview("return scrollY > 500"), "scroll position")
        request("POST", prefix + "/frame", {"id": None})
        until(lambda: execute("return window.__papyriScrollObserved"), "scroll bookmark delivered to host")
        document.write_text("# Live update" + body)
        until(lambda: preview("return document.querySelector('h1')?.textContent === 'Live update'"), "live file update")
        until(lambda: preview("return scrollY > 500"), "scroll restored after refresh")
        execute("document.querySelector('a[href=\"./sub/next.md\"]').click()")
        request("POST", prefix + "/frame", {"id": None})
        until(lambda: execute("return [...document.querySelectorAll('.tab-select')].some(b => b.textContent.includes('next.md') && b.getAttribute('aria-pressed') === 'true')"), "relative document navigation")
        frame()
        until(lambda: preview("return document.querySelector('h1')?.textContent === 'Linked document'"), "linked preview")
        element = request("POST", prefix + "/element", {"using": "css selector", "value": "h1"})
        element_id = next(iter(element.values()))
        request("POST", prefix + "/element/" + element_id + "/click", {})
        keyboard("\ue009", "\ue008", "\ue004")
        until(lambda: preview("return document.querySelector('h1')?.textContent === 'Live update'"), "native previous tab shortcut")
        keyboard("\ue009", "\ue004")
        until(lambda: preview("return document.querySelector('h1')?.textContent === 'Linked document'"), "native next tab shortcut")
        request("POST", prefix + "/frame", {"id": None})
        assert execute("return document.body.textContent.includes('.hidden.md')")
        scripted = root / "sub" / "next.md"
        script = "\n\n<script>document.body.dataset.executed='yes';try{parent.document.body.dataset.escaped='yes'}catch{document.body.dataset.isolated='yes'}setInterval(()=>parent.postMessage({type:'navigate',href:'/forged.md',channel:JSON.parse(document.getElementById('payload').textContent).channel},'*'),1);</script>"
        trusted_body = "# Trust test" + script + "\n\n" + "Trusted paragraph.\n\n" * 120
        scripted.write_text(trusted_body)
        until(lambda: preview("return document.querySelector('h1')?.textContent === 'Trust test'"), "safe script fixture")
        assert execute("return document.body.dataset.executed || null") is None
        request("POST", prefix + "/frame", {"id": None})
        execute("document.querySelector('.trust-button').click()")
        execute("document.querySelector('dialog .btn-primary').click()")
        until(lambda: preview("return document.body.dataset.executed === 'yes' && document.body.dataset.isolated === 'yes'"), "explicit native script trust and isolation")
        request("POST", prefix + "/frame", {"id": None})
        assert execute("return !document.body.dataset.escaped && !document.body.textContent.includes('forged.md')")
        control("scroll", "by", "300")
        control("scroll", "by", "-100")
        scripted.write_text("# Trust reset" + script)
        until(lambda: preview("return document.querySelector('h1')?.textContent === 'Trust reset'"), "trusted document change")
        assert execute("return document.body.dataset.executed || null") is None
        request("POST", prefix + "/frame", {"id": None})

        denial = asynchronous("const done=arguments[arguments.length-1]; window.__TAURI_INTERNALS__.invoke('read_document',{path:'/etc/passwd',hostToken:'forged'}).then(()=>done('BAD'),()=>done('denied'))")
        assert denial == "denied"
        assert execute("return !document.body.textContent.includes('forged.md')")
        execute("document.querySelector('[aria-label=\"Toggle split view\"]').click()")
        document.unlink()
        until(lambda: execute("return document.querySelector('.secondary-pane .error-banner')?.textContent.includes('File unavailable')"), "unavailable split document warning")
        (root / "created.md").write_text("# Created")
        until(lambda: execute("return document.body.textContent.includes('created.md')"), "directory live update")
        (root / "sub" / "next.md").unlink()
        until(lambda: execute("return document.body.textContent.includes('File unavailable')"), "deleted-file error")
        execute("[...document.querySelectorAll('.file-row')].find(button=>button.textContent.trim()==='paper.pdf').click()")
        until(lambda: execute("return document.querySelector('.document-path strong').title===" + json.dumps(str(root / "paper.pdf"))), "native PDF tab selected")
        frame()
        until(lambda: preview("return document.querySelector('#page-count')?.textContent==='of 2' && !!document.querySelector('.textLayer span')"), "native PDF rendering and text layer")
        assert execute("try { return parent.document ? false : false } catch { return true }")
        assert execute("return typeof window.__PAPYRI_HOST_TOKEN__") == "undefined"
        request("POST", prefix + "/frame", {"id": None})
        execute("document.querySelector('[aria-label=\"Fit document to width\"]').click()")
        frame()
        until(lambda: execute("const page=document.querySelector('.page'),width=page?.getBoundingClientRect().width;return width<=innerWidth+1&&width>=innerWidth-64"), "native PDF fit width")
        for scale in [50, 140, 200]:
            request("POST", prefix + "/frame", {"id": None})
            execute("window.dispatchEvent(new KeyboardEvent('keydown',{key:'0',ctrlKey:true,altKey:true}))")
            for _ in range(abs(scale - 100) // 10):
                execute("window.dispatchEvent(new KeyboardEvent('keydown',{key:'" + ("-" if scale < 100 else "+") + "',ctrlKey:true,altKey:true}))")
            frame()
            until(lambda: execute("const container=document.querySelector('#viewer-container'),page=document.querySelector('.page'),width=page?.getBoundingClientRect().width;return width<=innerWidth+1&&width>=innerWidth-64&&container.scrollWidth<=container.clientWidth+1"), "native PDF stays fitted at each UI scale")
        request("POST", prefix + "/frame", {"id": None})
        execute("window.dispatchEvent(new KeyboardEvent('keydown',{key:'0',ctrlKey:true,altKey:true}))")
        frame()
        until(lambda: execute("return document.querySelector('.page').getBoundingClientRect().width>=innerWidth-64"), "native PDF refitted after resetting UI scale")
        fitted_width = execute("return document.querySelector('.page').getBoundingClientRect().width")
        execute("window.dispatchEvent(new KeyboardEvent('keydown',{key:'+',ctrlKey:true}))")
        until(lambda: execute("return document.querySelector('.page').getBoundingClientRect().width>" + str(fitted_width)), "native PDF zoom increases fitted page width")
        execute("document.querySelector('#next-page').click()")
        until(lambda: execute("return document.querySelector('#page-number').value==='2'"), "native PDF page navigation")
        request("POST", prefix + "/frame", {"id": None})
        execute("[...document.querySelectorAll('.file-row')].find(button=>button.textContent.trim()==='paper.typ').click()")
        until(lambda: execute("return document.querySelector('.document-path strong').title===" + json.dumps(str(root / "paper.typ"))), "native Typst tab selected")
        frame()
        until(lambda: preview("return document.querySelector('.textLayer')?.textContent.includes('Imported dependency')"), "native sandboxed Typst preview")
        execute("document.documentElement.dataset.retained='yes'")
        (root / "paper.typ").write_text("#let broken =")
        request("POST", prefix + "/frame", {"id": None})
        until(lambda: execute("return document.body.textContent.includes('Typst compilation failed')"), "native Typst syntax diagnostic")
        frame()
        assert execute("return document.documentElement.dataset.retained==='yes' && document.querySelector('.textLayer').textContent.includes('Imported dependency')"), "compile failure retains preview"
        (root / "paper.typ").write_text('= Native Typst restored\n#include "part.typ"')
        until(lambda: preview("return document.querySelector('.textLayer')?.textContent.includes('Native Typst restored')"), "native Typst correction")
        (root / "part.typ").write_text("Changed imported dependency")
        until(lambda: preview("return document.querySelector('.textLayer')?.textContent.includes('Changed imported dependency')"), "native Typst import live update")
        request("POST", prefix + "/frame", {"id": None})
        control("ping", "--wait", "10")
        socket_path = control("socket").strip()
        assert socket_path == test_environment["PAPYRI_CONTROL_SOCKET"], socket_path
        tabs = control("tab", "list")
        assert "paper.typ" in tabs, tabs
        tab_json = json.loads(control("tab", "list", "--json"))
        assert set(tab_json) == {"tabs"} and tab_json["tabs"], tab_json
        completions = subprocess.run(
            [binary, "completions", "bash"],
            capture_output=True,
            text=True,
            env=test_environment,
            timeout=30,
        )
        assert completions.returncode == 0 and "_papyri" in completions.stdout, completions.stderr
        state = json.loads(control("state", "--json"))
        assert state["active"] == str(root / "paper.typ"), state
        control("scroll", "by", "300")
        state = json.loads(control("state", "--json"))
        assert next(tab for tab in state["tabs"] if tab["active"])["scroll"] > 0, state
        control("scroll", "by", "-100")
        state = json.loads(control("state", "--json"))
        assert next(tab for tab in state["tabs"] if tab["active"])["scroll"] > 0, state
        previous_active = state["active"]
        control("tab", "next")
        assert json.loads(control("state", "--json"))["active"] != previous_active
        control("focus", previous_active)
        assert json.loads(control("state", "--json"))["active"] == previous_active
        before = state["preferences"]
        control("preferences", "set", json.dumps({"theme": "latte", "network": True, "documentZoom": 120}), "--json")
        state = json.loads(control("state", "--json"))
        assert state["preferences"]["theme"] == "latte", state["preferences"]
        assert state["preferences"]["network"] is True, state["preferences"]
        assert state["preferences"]["documentZoom"] == 120, state["preferences"]
        control("panel", "sidebar", "off")
        state = json.loads(control("state", "--json"))
        assert state["view"]["sidebar"] is False, state["view"]
        control("panel", "sidebar", "on")
        control("decorationless", "on")
        state = json.loads(control("state", "--json"))
        assert state["view"]["decorationless"] is True, state["view"]
        until(
            lambda: execute("const hidden=s=>getComputedStyle(document.querySelector(s)).display==='none';return hidden('.app-header')&&hidden('.tab-bar')&&hidden('.document-toolbar')&&hidden('.status-bar')&&Math.abs(document.querySelector('.preview-pane').getBoundingClientRect().height-innerHeight)<=2"),
            "native decoration-less viewport",
        )
        control("decorationless", "off")
        state = json.loads(control("state", "--json"))
        assert state["view"]["decorationless"] is False, state["view"]
        until(
            lambda: execute("const shown=s=>getComputedStyle(document.querySelector(s)).display!=='none';return shown('.app-header')&&shown('.tab-bar')&&shown('.document-toolbar')&&shown('.status-bar')"),
            "native chrome restored",
        )
        launch = subprocess.run(
            [binary, "--decorationless"],
            capture_output=True,
            text=True,
            env=test_environment,
            timeout=90,
        )
        assert launch.returncode == 0, launch.stderr
        state = json.loads(control("state", "--json"))
        assert state["view"]["decorationless"] is True, state["view"]
        until(
            lambda: execute("return document.querySelector('.app-shell')?.classList.contains('decorationless')"),
            "CLI decoration-less mode on a running window",
        )
        control("decorationless", "off")
        logging_launch = subprocess.run(
            [binary, "--log", "terminal"],
            capture_output=True,
            text=True,
            env=test_environment,
            timeout=90,
        )
        assert logging_launch.returncode != 0
        assert "already running" in logging_launch.stderr, logging_launch.stderr
        control("search", "Imported")
        state = json.loads(control("state", "--json"))
        assert state["view"]["search"] is True and state["view"]["query"] == "Imported", state["view"]
        control("search", "")
        control("fit-width", "on")
        state = json.loads(control("state", "--json"))
        assert state["preferences"]["fitWidth"] is True, state["preferences"]
        control("fit-width", "off")
        control("preferences", "set", json.dumps({"theme": before["theme"], "network": before["network"], "documentZoom": before["documentZoom"], "fitWidth": before["fitWidth"]}), "--json")
        request("DELETE", prefix)
        session = None
        for args, expected in [(["--log", "terminal"], str(Path.cwd())), (["--log", "terminal", str(root)], str(root))]:
            options["capabilities"]["alwaysMatch"]["tauri:options"]["args"] = args
            session = request("POST", "/session", options)["sessionId"]
            prefix = "/session/" + session
            until(lambda: execute("return document.querySelector('input[aria-label=\"Directory path\"]')?.value === " + json.dumps(expected)), "CLI default and directory arguments")
            request("DELETE", prefix)
            session = None
        detached_socket = root / "detached.sock"
        detached_log = root / "detached.log"
        document.write_text("# Native works" + body)
        detached_environment = {
            **test_environment,
            "PAPYRI_CONTROL_SOCKET": str(detached_socket),
            "XDG_STATE_HOME": str(root / "detached-state"),
            "XDG_DATA_HOME": str(root / "detached-data"),
            "XDG_CONFIG_HOME": str(root / "detached-config"),
            "XDG_CACHE_HOME": str(root / "detached-cache"),
            "PAPYRI_STARTUP_TRACE": "1",
        }
        for name in ["detached-state", "detached-data", "detached-config", "detached-cache"]:
            (root / name).mkdir(parents=True, exist_ok=True)
        launch = subprocess.run(
            [binary, "--log", str(detached_log), str(document)],
            capture_output=True,
            text=True,
            env=detached_environment,
            timeout=30,
        )
        assert launch.returncode == 0, launch.stderr
        assert "started in the background" in launch.stderr, launch.stderr
        until(lambda: detached_log.exists() and "PAPYRI_NATIVE" in detached_log.read_text(), "detached app log")
        until(lambda: detached_socket.exists(), "detached app control socket")

        def detached_state():
            result = subprocess.run(
                [binary, "ctl", "--socket", str(detached_socket), "state", "--json"],
                capture_output=True,
                text=True,
                env=detached_environment,
                timeout=30,
            )
            assert result.returncode == 0, result.stderr
            return json.loads(result.stdout)

        until(lambda: detached_state()["active"] == str(document), "detached app document")
        quit_result = subprocess.run(
            [binary, "ctl", "--socket", str(detached_socket), "quit"],
            capture_output=True,
            text=True,
            env=detached_environment,
            timeout=30,
        )
        assert quit_result.returncode == 0, quit_result.stderr
        until(
            lambda: subprocess.run(
                [binary, "ctl", "--socket", str(detached_socket), "ping"],
                capture_output=True,
                text=True,
                env=detached_environment,
                timeout=30,
            ).returncode != 0,
            "detached app shutdown",
        )
        print(json.dumps({"native": "passed", "checks": ["CLI file/directory/current directory", "WebKit rendering", "theme and reflowing zoom without reloading", "fit-to-width", "next/previous tab shortcuts", "diagram expansion and close", "explorer resizing", "multiline bracket math and numbered references", "local images", "Mermaid and Graphviz WASM", "opaque frame", "explicit script trust and reset", "trusted control scroll", "host token denial", "live file and directory refresh", "scroll restoration", "relative Markdown links", "hidden entries", "deleted-file error", "split-pane error state", "PDF canvas/text/navigation/fit", "sandboxed Typst compilation", "Typst error retention and dependency refresh", "control socket and CLI", "CLI socket, tab list, completions", "control settings, panels, and decoration-less mode", "settings tabs and configurable fonts", "CLI decoration-less launch", "CLI detached logging", "image viewer and inline SVG", "recent folder persistence and palette"]}, indent=2))
    except Exception:
        if session:
            try:
                Path("/tmp/papyri-native-failure.png").write_bytes(base64.b64decode(request("GET", prefix + "/screenshot")))
                print("Native diagnostic:", execute("return {heading:document.querySelector('h1')?.textContent,trusted:document.getElementById('payload')?JSON.parse(document.getElementById('payload').textContent).trusted:null,dataset:{...document.body.dataset},image:document.querySelector('img')?{src:document.querySelector('img').src.slice(0,50),complete:document.querySelector('img').complete,top:document.querySelector('img').getBoundingClientRect().top,height:innerHeight,scroll:scrollY}:null,documentScripts:[...document.querySelectorAll('#document script')].map(s=>s.textContent)}"))
                request("POST", prefix + "/frame", {"id": None})
                print("Host layout:", execute("return {width:innerWidth,height:innerHeight,zoom:document.documentElement.style.zoom,sidebar:!!document.querySelector('.sidebar'),focus:document.activeElement?.tagName}"))
                print("Host trust state:", execute("return document.querySelector('.trust-button')?.textContent"))
            except Exception as error:
                print("Diagnostic unavailable:", str(error))
        if detached_log and detached_log.exists():
            print("Detached log:", detached_log.read_text())
        if detached_socket and detached_socket.exists():
            try:
                print("Detached state:", detached_state())
            except Exception as error:
                print("Detached state unavailable:", str(error))
        raise
    finally:
        if session:
            request("DELETE", "/session/" + session)
        try:
            os.killpg(driver.pid, signal.SIGTERM)
        except ProcessLookupError:
            pass
        driver.wait(timeout=10)
        log.close()
