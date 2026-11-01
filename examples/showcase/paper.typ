#set document(title: "Papyri Typst showcase", author: "Papyri")
#set page(numbering: "1")
#set text(size: 11pt)

= Typst showcase

This document is compiled locally to PDF. Try page navigation, search for *PAPYRI-NEEDLE*, zoom, text selection, and the outline.

#outline()

== Mathematics and image

The Gaussian integral is $ integral_(-infinity)^infinity e^(-x^2) dif x = sqrt(pi) $.

#image("assets/orbit.svg", width: 55%)

#include "parts/typst-section.typ"

== Bibliography

A small citation @example2024 uses the local bibliography file.

#bibliography("references.bib", title: none)
