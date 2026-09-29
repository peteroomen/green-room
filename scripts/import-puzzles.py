"""Curate 300 CC0 Lichess puzzles from a downloaded .csv.zst (full or prefix).
Usage: python3 scripts/import-puzzles.py /path/lichess_db_puzzle.csv.zst
Requires: pip install zstandard
"""
import csv,io,json,sys,zstandard
from pathlib import Path
rows=[];buckets={}
with open(sys.argv[1],'rb') as source:
 reader=csv.DictReader(io.TextIOWrapper(zstandard.ZstdDecompressor().stream_reader(source)))
 for p in reader:
  rating=int(p['Rating']);bucket=rating//200
  if 600<=rating<=1800 and int(p['NbPlays'])>=1000 and int(p['Popularity'])>=85 and buckets.get(bucket,0)<55:
   rows.append({'id':p['PuzzleId'],'fen':p['FEN'],'moves':p['Moves'].split(),'rating':rating,'themes':p['Themes'].split(),'url':p['GameUrl']});buckets[bucket]=buckets.get(bucket,0)+1
  if len(rows)>=300:break
Path('src/data/puzzles.json').write_text(json.dumps(rows,indent=2))
print(f'Curated {len(rows)} puzzles; rating buckets {buckets}')
