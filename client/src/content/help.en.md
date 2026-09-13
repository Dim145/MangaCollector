# Help

Everything the app does, explained once. The Japanese glyphs used as
visual markers are listed in the [glossary](/glossary).

## Adding a series

From **Add**, search by title: results come from MyAnimeList, with
MangaDex as a fallback. A series arrives with its volume count, its
cover and its genres.

- A series in neither catalogue can be created by hand, with your own
  title and your own volume count.
- The **scan** button in the header reads a barcode and takes you
  straight where it belongs.
- Importing from MyAnimeList, AniList, MangaDex or a Yamtrack CSV lives
  in the settings.

## Volumes

Each series has a page, and each volume on it has a state. Clicking a
tile marks the volume as owned; the pencil opens the detail drawer.

- **Owned** and **read** are independent: you can hold a volume without
  having read it, and the other way round.
- Price and shop feed the spending figures.
- A **collector** edition is marked with the 限 seal.
- A **box set** groups several volumes under one price.

## The physical copy

A volume's drawer describes the object, not the work.

- **Condition**: new, like new, good, fair, worn.
- **Where it lives**: free text. Names already in use are suggested.
- **Extra copies**: how many beyond the first. A ×N seal appears on the
  volume's tile.
- **Bought on** and **ISBN**: the purchase date and the barcode on the
  back cover.

## Loans

Lending a volume happens from its drawer. The volume is still yours, it
is just elsewhere.

- A loan can point at a **friend** on the app, and their side then shows
  the volume among what they borrowed.
- An optional **return date** turns the loan overdue once it passes; the
  navigation counter says so.
- The **ledger** keeps every loan ever made, returns included, and
  exports as CSV.

## The scanner

The scanner runs entirely in the browser: no image leaves the device.

- A barcode already on your shelf opens the series, offers to count one
  more copy, or moves to the next one.
- An unknown barcode goes to the add flow, with the title already filled
  in when a catalogue knows it.
- With no camera, or with the camera refused: **a photo** or **typing
  the number** follow exactly the same path.
- On a dark spine, the **torch** and the **zoom** appear when the device
  can do them.

## Storage and stock-taking

- **Storage** lists the places and what sits in them. Volumes move by
  selection, or by scanning their spines.
- **Stock-taking** counts a shelf: scan the spines one by one, what was
  never scanned is what is missing. Lent volumes are set apart.
- Both can print a **label sheet** carrying each volume's barcode.

## Offline

The app keeps a local copy of the collection and works with no network.

- An edit made offline is saved at once and reaches the server when the
  network returns, in order.
- Several devices keep each other in step as soon as they are online.
- The scanner and searching your own library work offline. Only asking
  the catalogues needs a network.

## Backup

The settings offer a complete export.

- **JSON**: everything, loans, storage and notes included. This is the
  format to import back.
- **CSV**: one row per volume, for a spreadsheet.
- On import, **merge** fills in what is missing, **replace** restores
  the file's state.

## Settings

- **Theme**, light or dark, and seven accent colours.
- **Language**: English, French, Spanish.
- **Public profile**: a shareable address showing your collection
  without your prices or your notes.
- **Vibration** and **sound** switch off separately.
