# Testing compiler errors and recovery

[Back to the showcase](./README.md)

The examples below intentionally fail. They do not change other files.

- Open [broken Typst](./broken.typ) to see a syntax diagnostic. Correct the malformed line in an external editor and reopen it to retry.
- Open [broken LaTeX](./broken.tex) to see a compiler diagnostic. Correct the undefined command and reopen it to retry.
- To test retaining the last successful preview, first open [paper.typ](./paper.typ) or [paper.tex](./paper.tex), then temporarily introduce a syntax error in its source or imported section. Save it and wait for the diagnostic. The previous PDF should remain visible. Restore the original text and save to recover.
- In Settings, temporarily enter a nonexistent absolute compiler path. Opening or refreshing the corresponding document should show an error. Clear the path afterward to return to discovery.

LaTeX projects requiring Biber and diagrams using PlantUML currently show a limitation rather than being rendered.
