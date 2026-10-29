# PDF fixtures

`paged.typ` is the source of the two-page `paged.pdf` fixture. Regenerate it with the locked development shell:

```sh
typst compile --ignore-system-fonts e2e/fixtures/paged.typ e2e/fixtures/paged.pdf
```

`scripted.pdf` and `protected.pdf` derive from that PDF using pypdf 6.20.0. They test ignored PDF JavaScript and password entry; the fixture password is `papyri-test-password`. pypdf is a fixture-generation tool, not an application or test-runtime dependency:

```python
from pypdf import PdfReader, PdfWriter

reader = PdfReader("e2e/fixtures/paged.pdf")
writer = PdfWriter(clone_from=reader)
writer.add_js("globalThis.__pdfScriptRan = true; app.alert('PDF scripts must stay disabled');")
writer.write("e2e/fixtures/scripted.pdf")
writer = PdfWriter(clone_from=reader)
writer.encrypt("papyri-test-password")
writer.write("e2e/fixtures/protected.pdf")
writer = PdfWriter()
for _ in range(200):
    writer.add_page(reader.pages[0])
writer.write("e2e/fixtures/many-pages.pdf")
```
