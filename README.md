# taina

**Text that becomes a symmetric ornament — and can be read back.**

taina turns any text into a decorative, mirror-symmetric pattern (bytecode ornament). The ornament is not just an image — it contains the original message and can be decoded by scanning it with a phone camera.

🔗 **Live app:** [taina-2.vercel.app](https://taina-2.vercel.app)
🖼 **Gallery:** [taina-2.vercel.app/gallery.html](https://taina-2.vercel.app/gallery.html)

## How it works

1. You type a word or message
2. It becomes a symmetric ornament — instantly, as you type
3. The ornament can be saved as PNG and shared
4. Anyone can scan it (camera or file) and read the hidden text

Each ornament has a permanent shareable link with a preview card for Telegram, Facebook, etc.

## Features

- **Monochrome mode** — single-colour ornament with a palette of colours to choose from
- **RGB mode** — text is split across three colour channels, producing a multicolour pattern
- **Camera scanner** — point your phone camera at an ornament to read it instantly
- **Gallery** — publish ornaments to a shared public gallery
- **Sharing** — each ornament gets a unique URL with Open Graph preview

## How the encoding works

`text → UTF-8 bytes → bits → cell grid → symmetric expansion → framed ornament`

The same information exists at every step. Nothing is added, nothing is lost. The ornament IS the text.

Symmetry modes: ×8 (octant / snowflake), ×4 (quarter), ×2 (mirror), ×1 (row).

## Scientific Publication

* **Title:** Bytecode: A Method for Rendering Text as a Readable Symmetric Ornament
* **Zenodo Record:** [22092011](https://zenodo.org/records/22092011)
* **DOI:** 10.5281/zenodo.22092011
* **License:** CC BY 4.0

## Author

**Mykhailo Kashkarov** — artist, inventor, researcher at the intersection of art, science, and technology (Ukraine).

## License

CC BY 4.0
