#!/usr/bin/env python3
"""Preprocess LA tree inventory into foraging-focused outputs."""

from __future__ import annotations

import csv
import json
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RAW_CSV = ROOT / "data" / "Los Angeles Tree Inventory Abridged.csv"
OUT_CLEAN_CSV = ROOT / "data" / "forage_edible_cleaned.csv"
OUT_SPECIES_SUMMARY = ROOT / "data" / "forage_species_summary.csv"
OUT_AUDIT = ROOT / "data" / "forage_edible_audit.csv"
OUT_JSON = ROOT / "data" / "forage_trees.json"
OUT_TOP50_SEASONALITY = ROOT / "data" / "forage_top50_seasonality.csv"

NON_TREE_MARKERS = (
    "vacant site",
    "obsolete site",
    "stump",
    "myla311",
)

# Demote species currently marked edible that are not practical fruit/nut foraging targets.
FORCE_INEDIBLE = {
    "crape myrtle (Lagerstroemia indica)": "Ornamental species; flowers are technically edible but not a practical forage target.",
    "camphor tree (Cinnamomum camphora)": "Not a safe practical forage species for public fruit harvesting.",
    "Brazilian pepper tree (Schinus terebinthefolia)": "Safety/allergen concerns; excluded for conservative public foraging filter.",
    "blue palo verde (Parkinsonia florida)": "Seeds can be eaten but this is uncommon and not easy urban fruit foraging.",
    "sweet olive (Osmanthus fragrans)": "Fragrant ornamental; not a practical fruit-tree forage target.",
    "sweet viburnum (Viburnum odoratissimum)": "Ornamental hedge species; fruit use is uncommon for urban foraging.",
}

# Promote likely edible species that appear in the dataset with Edible=False.
FORCE_EDIBLE = {
    "white mulberry (Morus alba)": "Edible mulberries; commonly foraged fruit.",
    "red mulberry (Morus rubra)": "Edible mulberries; commonly foraged fruit.",
    "English walnut (Juglans regia)": "Edible nuts.",
    "southern California black walnut (Juglans californica)": "Edible nuts.",
    "northern California black walnut (Juglans hindsii)": "Edible nuts.",
    "Asian pear (Pyrus pyrifolia)": "Edible fruit.",
    "Surinam cherry (Eugenia uniflora)": "Edible fruit.",
    "Java plum (Syzygium cumini)": "Edible fruit.",
    "Pakistan mulberry (Morus macroura)": "Edible fruit.",
    "Korean mulberry (Morus indica)": "Edible fruit.",
    "paper mulberry (Broussonetia papyrifera)": "Edible fruit pulp (limited but forageable).",
}

# Los Angeles-oriented harvest windows, month numbers (1-12).
# Window can wrap year-end (e.g. 11->3 means Nov..Mar).
SEASONALITY = {
    "olive (Olea europaea)": (9, 11),
    "edible loquat (Eriobotrya japonica)": (3, 5),
    "cherry plum (Prunus cerasifera)": (5, 7),
    "carob (Ceratonia siliqua)": (8, 10),
    "citrus (Citrus spp.)": (11, 4),
    "avocado (Persea americana)": (10, 5),
    "guava (Psidium guajava)": (8, 11),
    "orange (Citrus sinensis)": (12, 4),
    "Manila tamarind; guamuchil (Pithecellobium dulce)": (7, 10),
    "peach (Prunus persica)": (5, 8),
    "edible fig (Ficus carica)": (6, 9),
    "lemon (Citrus limon)": (11, 4),
    "black walnut (Juglans nigra)": (9, 10),
    "pomegranate (Punica granatum)": (9, 11),
    "date palm (Phoenix dactylifera)": (8, 11),
    "apple (Malus domestica)": (8, 10),
    "white sapote (Casimiroa edulis)": (11, 3),
    "pecan (Carya illinoinensis)": (9, 11),
    "grapefruit (Citrus paradisi)": (12, 4),
    "cherimoya (Annona cherimola)": (11, 3),
    "apricot (Prunus armeniaca)": (5, 6),
    "Japanese edible plum (Prunus salicina)": (6, 8),
    "fig species (Ficus spp.)": (6, 9),
    "pineapple guava; feijoa (Acca sellowiana)": (10, 12),
    "pindo palm; jelly palm (Butia odorata)": (7, 10),
    "edible pear (Pyrus communis)": (8, 10),
    "Mexican lime (Citrus x aurantiifolia)": (7, 10),
    "papaya (Carica papaya)": (1, 12),
    "European edible plum (Prunus domestica)": (6, 8),
    "Japanese persimmon (Diospyros kaki)": (10, 12),
    "sweet cherry (Prunus avium)": (5, 6),
    "mango (Mangifera indica)": (7, 9),
    "Mandarin orange (Citrus reticulata)": (11, 3),
    "strawberry guava (Psidium cattleyanum)": (9, 12),
    "Black cherry (Prunus serotina)": (7, 8),
    "Chinese jujube (Ziziphus jujuba)": (8, 10),
    "kumquat (Citrus japonica)": (12, 3),
    "nectarine (Prunus persica var. nucipersica)": (6, 8),
    "almond (Prunus dulcis)": (8, 9),
    "black mulberry (Morus nigra)": (4, 6),
    "capulin cherry (Prunus salicifolia)": (6, 7),
    "Bearss lime (Citrus latifolia)": (7, 10),
    "tamarind (Tamarindus indica)": (12, 4),
    "crabapple (Malus hybrids and cvs - crabapple)": (8, 10),
    "rose apple (Syzygium jambos)": (6, 8),
    "American persimmon (Diospyros virginiana)": (9, 11),
    "kaffir lime; makrut lime; Thai lime (Citrus hystrix)": (10, 2),
    "bitter orange (Citrus x aurantium)": (12, 3),
    "Longon (Dimocarpus longon)": (7, 9),
    "edible pistachio (Pistacia vera)": (9, 10),
    "tangelo (Citrus x tangelo)": (12, 3),
    "quince (Cydonia oblonga)": (9, 11),
    "pomelo (Citrus maxima)": (11, 2),
    "jackfruit (Artocarpus heterophyllus)": (7, 9),
    "calamansi; calamondin (x Citrofortunella microcarpa)": (11, 4),
    "banana (Musa x paradisiaca)": (1, 12),
    "sapodilla (Manilkara zapota)": (5, 9),
    "soursop (Annona muricata)": (7, 10),
    "Meyer lemon (Citrus x meyeri)": (11, 3),
    "European grape (Vitis vinifera)": (8, 10),
    "lychee (Litchi chinensis)": (6, 7),
    "lemon guava (Psidium cattleianum ssp lucidum)": (9, 12),
    "Jamaican cherry tree (Muntingia calabura)": (1, 12),
    "mamey; mamey sapote (Pouteria sapota)": (5, 8),
    "black sapote (Diospyros nigra)": (11, 2),
    "white mulberry (Morus alba)": (4, 6),
    "red mulberry (Morus rubra)": (4, 6),
    "English walnut (Juglans regia)": (9, 10),
    "southern California black walnut (Juglans californica)": (9, 10),
    "northern California black walnut (Juglans hindsii)": (9, 10),
    "Asian pear (Pyrus pyrifolia)": (8, 10),
    "Surinam cherry (Eugenia uniflora)": (4, 6),
    "Java plum (Syzygium cumini)": (6, 8),
    "Pakistan mulberry (Morus macroura)": (4, 6),
    "Korean mulberry (Morus indica)": (4, 6),
    "paper mulberry (Broussonetia papyrifera)": (4, 6),
}


@dataclass
class RowOut:
    lat: float
    lon: float
    species: str
    season_start: int
    season_end: int


def parse_bool(value: str) -> bool:
    return str(value).strip().lower() == "true"


def has_valid_coords(lat: float, lon: float) -> bool:
    if lat == 0.0 and lon == 0.0:
        return False
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        return False
    # Keep points roughly in greater LA bounds to catch obvious bad rows.
    if not (33.0 <= lat <= 35.0 and -119.2 <= lon <= -117.5):
        return False
    return True


def is_non_tree_placeholder(species: str) -> bool:
    low = species.lower()
    return any(marker in low for marker in NON_TREE_MARKERS)


def passes_palm_rule(species: str) -> bool:
    low = species.lower()
    if "palm" not in low:
        return True
    # Keep palms that are practical forage targets.
    allow = ("date palm", "jelly palm", "pindo palm")
    return any(x in low for x in allow)


def season_for_species(species: str) -> tuple[int, int]:
    # default to full-year unknown/assume available where no season data exists.
    return SEASONALITY.get(species, (1, 12))


def month_in_season(month: int, start: int, end: int) -> bool:
    if start <= end:
        return start <= month <= end
    return month >= start or month <= end


def season_stage(month: int, start: int, end: int) -> str:
    if not month_in_season(month, start, end):
        return "out"
    span = end - start + 1 if start <= end else (12 - start + 1) + end
    if start <= end:
        offset = month - start
    elif month >= start:
        offset = month - start
    else:
        offset = 12 - start + month
    pct = 1.0 if span <= 1 else offset / (span - 1)
    if pct <= 0.33:
        return "beginning"
    if pct <= 0.66:
        return "middle"
    return "end"


def main() -> None:
    rows_out: list[RowOut] = []
    species_counts = Counter()
    species_source_edible = Counter()
    species_final_edible = Counter()
    audit_rows = []

    with RAW_CSV.open("r", newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        total = 0
        for row in reader:
            total += 1
            species = row["Species"].strip()
            source_edible = parse_bool(row["Edible"])
            species_counts[species] += 1
            if source_edible:
                species_source_edible[species] += 1

            if is_non_tree_placeholder(species):
                continue

            final_edible = source_edible
            reason = ""

            if species in FORCE_EDIBLE:
                final_edible = True
                reason = FORCE_EDIBLE[species]
            if species in FORCE_INEDIBLE:
                final_edible = False
                reason = FORCE_INEDIBLE[species]

            if final_edible and not passes_palm_rule(species):
                final_edible = False
                reason = "Palm species excluded unless practical date/jelly palm forage target."

            if not final_edible:
                if reason:
                    audit_rows.append(
                        {
                            "Species": species,
                            "SourceEdible": source_edible,
                            "FinalEdible": final_edible,
                            "Reason": reason,
                        }
                    )
                continue

            try:
                lat = float(row["Latitude"])
                lon = float(row["Longitude"])
            except ValueError:
                continue

            if not has_valid_coords(lat, lon):
                continue

            start, end = season_for_species(species)
            rows_out.append(RowOut(lat=lat, lon=lon, species=species, season_start=start, season_end=end))
            species_final_edible[species] += 1

            if reason:
                audit_rows.append(
                    {
                        "Species": species,
                        "SourceEdible": source_edible,
                        "FinalEdible": final_edible,
                        "Reason": reason,
                    }
                )

    # cleaned CSV
    with OUT_CLEAN_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Latitude", "Longitude", "Species", "SeasonStartMonth", "SeasonEndMonth"])
        for r in rows_out:
            writer.writerow([f"{r.lat:.8f}", f"{r.lon:.8f}", r.species, r.season_start, r.season_end])

    # species summary
    with OUT_SPECIES_SUMMARY.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(
            [
                "Species",
                "RowsInRaw",
                "RowsSourceEdibleTrue",
                "RowsFinalIncluded",
                "SourceEdibleFraction",
                "FinalIncludedFraction",
                "SeasonStartMonth",
                "SeasonEndMonth",
            ]
        )
        for species, count in species_counts.most_common():
            source_true = species_source_edible[species]
            final_true = species_final_edible[species]
            if final_true == 0:
                continue
            start, end = season_for_species(species)
            writer.writerow(
                [
                    species,
                    count,
                    source_true,
                    final_true,
                    f"{source_true / count:.6f}",
                    f"{final_true / count:.6f}",
                    start,
                    end,
                ]
            )

    # audit
    dedup = {}
    for row in audit_rows:
        dedup[row["Species"]] = row

    with OUT_AUDIT.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Species", "RowsInRaw", "RowsSourceEdibleTrue", "RowsFinalIncluded", "SourceEdible", "FinalEdible", "Reason"])
        for species, row in sorted(dedup.items()):
            writer.writerow(
                [
                    species,
                    species_counts[species],
                    species_source_edible[species],
                    species_final_edible[species],
                    row["SourceEdible"],
                    row["FinalEdible"],
                    row["Reason"],
                ]
            )

    now_month = datetime.now().month
    with OUT_TOP50_SEASONALITY.open("w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["Rank", "Species", "Count", "SeasonStartMonth", "SeasonEndMonth", "CurrentMonth", "CurrentStage"])
        for i, (species, count) in enumerate(species_final_edible.most_common(50), start=1):
            start, end = season_for_species(species)
            writer.writerow([i, species, count, start, end, now_month, season_stage(now_month, start, end)])

    # frontend JSON payload (compact)
    species_sorted = [name for name, _ in species_final_edible.most_common()]
    species_index = {name: i for i, name in enumerate(species_sorted)}

    species_payload = []
    for name in species_sorted:
        start, end = season_for_species(name)
        species_payload.append(
            {
                "id": species_index[name],
                "name": name,
                "count": species_final_edible[name],
                "seasonStart": start,
                "seasonEnd": end,
            }
        )

    points_payload = [
        [round(r.lat, 7), round(r.lon, 7), species_index[r.species]]
        for r in rows_out
    ]

    out = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceFile": str(RAW_CSV.name),
        "rawRows": total,
        "finalRows": len(rows_out),
        "speciesCount": len(species_sorted),
        "seasonalityCoverage": sum(1 for s in species_sorted if s in SEASONALITY),
        "species": species_payload,
        "points": points_payload,
    }
    with OUT_JSON.open("w", encoding="utf-8") as f:
        json.dump(out, f, separators=(",", ":"))

    print(f"Raw rows: {total}")
    print(f"Final edible rows: {len(rows_out)}")
    print(f"Final edible species: {len(species_sorted)}")
    print(f"Seasonality mapped species: {out['seasonalityCoverage']}")
    print(f"Wrote: {OUT_CLEAN_CSV}")
    print(f"Wrote: {OUT_SPECIES_SUMMARY}")
    print(f"Wrote: {OUT_AUDIT}")
    print(f"Wrote: {OUT_TOP50_SEASONALITY}")
    print(f"Wrote: {OUT_JSON}")


if __name__ == "__main__":
    main()
