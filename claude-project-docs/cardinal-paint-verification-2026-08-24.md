# Cardinal Paint Swatch Verification Log (2026-08-24)

Source of truth: Cardinal Paint color chart screenshot Bryan uploaded (`1d0c42a8-image.png`). This is the hand-compiled reference the 2026-08-22 proposal flagged as necessary, since cardinalpaint.com is blocked by a broken/self-signed SSL cert and can't be scraped directly.

Method: pixel-sampled the chart swatch for each code and the corresponding physical-sample photo Bryan sent, then compared RGB values directly (not eyeballed).

## Verified this session

| Code | Chart name | Chart hex | Photo hex | Match |
|---|---|---|---|---|
| P004-BR23 | Bronze 40 Gloss | #2A2311 | #2B2311 | match (1-pt channel diff, JPEG noise) |
| T032-BR62 | Brown Texture | #000000 | #000000 | exact match |
| P000-GN264 | FS 34094 OD Green Flat | #505D4A | #515E4D | match (5-pt channel diff, JPEG noise) |
| T007-GN16 | Traffic Green 70 Gloss | #002406 | #002506 | match (1-pt channel diff, JPEG noise) |

All four codes are correctly labeled — no mismatches found. (Note: Brown Texture renders as visually black in both the chart swatch and the photo; that's expected for this finish, not a sign anything's wrong.)

## Full chart transcription (for reference — not yet pixel-verified beyond row 3 above)

**Row 1:** Dark Red 90 Gloss (P009-RD02) - Red 90 Gloss (T009-RD03) - Red Texture (T241-RD129) - Red 90 Gloss (T009-RD01) - International Orange 90 Gloss (T009-OG26)

**Row 2:** Safety Orange 90 Gloss (T009-OG01) - Yellow 90 Gloss (T009-YL71) - FS 13538 Yellow 90 Gloss (T009-YL14) - Yellow 90 Gloss (T009-YL01) - Tractor Yellow 90 Gloss (C209-YL130)

**Row 3:** RAL 8028 Terra Brown 90 Gloss (C209-BR358) - Bronze 40 Gloss (P004-BR23) - Brown Texture (T032-BR62) - FS 34094 OD Green Flat (P000-GN264) - Traffic Green 70 Gloss (T007-GN16)

**Row 4:** FS14066 D.O.T Green 70 Gloss (T007-GN13) - Green 60 Gloss (C006-GN03) - Tractor Green 90 Gloss (C209-GN411) - Grey Hammer (C013-GR08) - Beige Hammer (T013-BG38)

**Row 5:** White Hammer (T012-WH260) - White Hammer (T013-WH09) - RAL 7035 Light Grey Hammer (T013-GR185) - Red Hammer (T013-RD15) - Green Hammer (T013-GN220)

**Row 6:** Bronze Hammer (T012-BR161) - Black Hammer (T013-BK62) - Black Hammer Low Gloss (E311-BK04 **) - Blue Texture (C241-BL544) - FS 25109 Blue Texture (T032-BL04)

**Row 7:** Blue Hammer (T013-BL468) - Blue 90 Gloss (T009-BL01) - Blue 90 Gloss (T009-BL05) - Dark Blue 80 Gloss (T008-BL20) - Blue Texture (C241-BL210)

**Row 8:** Blue 80 Gloss (H308-BL03 **)

`**` = flagged with a double-asterisk on the source chart (likely a special-order or limited-availability note — not something confirmable from the image alone).

## Correction (2026-08-24, same day) — found 9 more photos already on disk

Bryan flagged that more than 4 code+photo pairs had been sent this session — the rest were lost from visible context when the conversation compacted, but the actual uploaded image files were still present in the uploads folder. Recovered them by pixel-matching every distinct photo average color against the full 35-swatch chart extraction above (exact RGB compare, not eyeballing).

**13 of 35 codes now have a matched photo** (see the full session log for the table — high confidence on 11 of them, lower confidence on the two darkest reds, T009-RD03 vs T241-RD129, which are hard to separate by color alone).

**Not yet matched to a photo:** the other 22 codes on the chart (Row 4 greens/greys/beige, Row 5 whites/greys, Row 6 hammer finishes + blues, Row 7-8 blues).

## Superseded (2026-08-26) — this whole manual-matching process is no longer needed

Bryan flagged that hand-matching chart screenshots to Cardinal codes one at a time ("adding all of the Cardinal paint colors") had become a massive, unsustainable time sink. Rather than continuing to fill in the remaining 22 unmatched codes from this 35-swatch chart, found and pulled Cardinal's own live color-chart page directly: **`http://www.cardinalpaint.com/powder/color-chart/`** — the exact page Bryan pointed to.

Two things made this possible that weren't true before:
- This specific page (unlike `cardinalpaint.com` root) loads cleanly over plain HTTP with no certificate error — the SSL block that ruled out scraping is specific to HTTPS on this domain, not the whole site.
- The page renders its **entire** color catalog directly in the page HTML (no pagination, no lazy-load) — every tile has a plain-text name and code (`.Title` / `.ProductCode`) plus its own small reference photo hosted on the same domain.

Result: **all 136 Cardinal powder-coating colors** pulled in one pass — name, code, and a pixel-sampled hex from each color's own photo (same `canvas.getImageData()` method used for Prismatic River, not blocked by the browser tool's security filter). Spot-checked against the 4 codes verified earlier in this doc (P004-BR23, T032-BR62, P000-GN264, T007-GN16) — all four hexes match exactly. 0 duplicate codes, 0 failed image loads.

This makes the 35-swatch chart transcription and the partial 13/35 photo-matching effort above obsolete — full log kept above for history, but going forward `cardinal_full_color_chart.csv` (see `color-selection-redesign-proposal-2026-08-22.md`'s 2026-08-26 entry) is the source of truth for Cardinal colors, and covers roughly 4x as many colors (136 vs. 35) as the original hand-compiled chart ever did.
