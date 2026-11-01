# Markdown and mathematics

[Back to the showcase](./README.md) · [Open diagrams](./diagrams.md) · [Jump to references](#references)

## Text and links

This page exercises **bold**, _emphasis_, ~~strikethrough~~, `inline code`, an [external link](https://example.org), and an autolink: https://example.org. PAPYRI-NEEDLE is a distinctive search target.

> A block quote can contain a second paragraph.
>
> Use the outline to navigate between headings.

- [x] Open the project
- [ ] Try split view
  - A nested bullet
  - Another nested bullet

1. First numbered item
2. Second numbered item

| Feature  | Example           | Expected           |
| :------- | :---------------- | :----------------- |
| Table    | Three columns     | Aligned content    |
| Footnote | Local note[^note] | Clickable footnote |
| Image    | Local SVG         | Visible below      |

![A violet orbit around a small star](./assets/orbit.svg)

[^note]: This is an ordinary footnote with a return link.

## Code and layout

```python
def mean(values):
    return sum(values) / len(values)

print(mean([1, 2, 3]))
```

A long line for testing horizontal scrolling in normal reading mode and wrapping in fit-to-width mode:

```text
PAPYRI-NEEDLE /documents/observations/measurements/2026/session/very-long-example-path/with-several-segments/to-check-horizontal-scrolling-and-fit-width.txt
```

## Mathematics and references

Inline math uses the default `\(` and `\)` delimiters: \(e^{i\pi}+1=0\). Equation (7) and citation [1] should link to their targets. Unmatched [99] remains plain text.

$$
\int_{-\infty}^{\infty} e^{-x^2}\,dx = \sqrt{\pi} \tag{7}
$$

\[
\begin{bmatrix}a & b\\c & d\end{bmatrix}
\begin{bmatrix}x\\y\end{bmatrix}
=

\begin{bmatrix}ax+by\\cx+dy\end{bmatrix}
\]

[ \frac{1}{n}\sum_{i=1}^{n} x_i ]

## HTML and trust

<details><summary>Open this disclosure</summary><p>Safe semantic HTML is rendered inside the isolated preview.</p></details>

<span id="trust-example">The optional script has not run.</span>

<script>
document.getElementById('trust-example').textContent = 'Trusted script ran in the isolated preview.';
</script>

In safe mode the script is removed. To test trusted scripts, trust this document using the app's shield control; the message above should change. Only trust files you know. The example makes no network requests.

## References

1. Example, A. _A Small Reference for Papyri_. 2024.
2. Reader, B. _A Second Reference_. 2025.
