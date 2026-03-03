# LA Forage Trees

This project preprocesses the LA tree inventory and serves a mobile-friendly WebGL app for edible tree foraging.

## Generate preprocessed data

```bash
python3 scripts/preprocess_trees.py
```

Outputs:
- `data/forage_edible_cleaned.csv`
- `data/forage_species_summary.csv`
- `data/forage_edible_audit.csv`
- `data/forage_top50_seasonality.csv`
- `data/forage_trees.json`

## Run the app

```bash
python3 -m http.server 5173
```

Then open:
- `http://localhost:5173/app/`

## Notes

- Map rendering uses `deck.gl` + WebGL on top of MapLibre.
- Species filtering updates on every keystroke with autocomplete suggestions.
- `In season only` hides species currently out of season.
- Compass mode requires location and orientation permissions.
- On iOS Safari, orientation permission must be granted after tapping `Enable Compass + GPS`.
