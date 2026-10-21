"""Persistent AT day-ahead observations and an explicitly selected interval set."""
import contextlib
import datetime as dt
import hashlib
import json
import logging
import math
import os
from pathlib import Path
import sqlite3
import time

UTC=dt.timezone.utc
ATTRIBUTION='Bundesnetzagentur | SMARD.de'


class PriceDataError(ValueError):
    def __init__(self,code,message):
        self.code=code
        super().__init__(message)


class PriceStore:
    def __init__(self,path=None):
        self.path=Path(path or os.environ.get('EDOPT_PRICE_CACHE_PATH') or Path(__file__).resolve().parents[2]/'data'/'historical_prices.sqlite3').resolve()
        self.path.parent.mkdir(parents=True,exist_ok=True)
        with self.connect() as db:
            db.executescript('''
            PRAGMA journal_mode=WAL;
            CREATE TABLE IF NOT EXISTS observations (
              hash TEXT PRIMARY KEY, start INTEGER, end INTEGER, price REAL, provenance TEXT);
            CREATE TABLE IF NOT EXISTS prices (
              start INTEGER PRIMARY KEY, end INTEGER NOT NULL, hash TEXT REFERENCES observations(hash));
            CREATE INDEX IF NOT EXISTS price_end ON prices(end);
            CREATE TABLE IF NOT EXISTS conflicts (
              old_hash TEXT, new_hash TEXT, detected_at TEXT,
              UNIQUE(old_hash,new_hash));
            ''')

    @contextlib.contextmanager
    def connect(self):
        db=sqlite3.connect(str(self.path),timeout=60)
        try:
            with db:yield db
        finally:db.close()

    def persistence(self):
        configured=bool(os.environ.get('EDOPT_PRICE_CACHE_PATH'))
        warnings=[]
        if not configured:
            warnings.append('Default local cache path. Deployments must set EDOPT_PRICE_CACHE_PATH to a persistent mounted volume; deployment persistence cannot be verified automatically.')
        if any(part.lower() in ('tmp','temp') for part in self.path.parts):
            warnings.append('Cache is in a temporary directory. Configure a persistent path before production use.')
        return dict(path=str(self.path),configured_path=configured,warnings=warnings)

    @contextlib.contextmanager
    def import_lock(self,notify=lambda:None):
        # OS locks serialize imports across backend processes, and release on crash.
        with open(str(self.path)+'.import.lock','a+b') as stream:
            if stream.tell()==0: stream.write(b'0');stream.flush()
            while True:
                try:
                    stream.seek(0)
                    if os.name=='nt':
                        import msvcrt
                        msvcrt.locking(stream.fileno(),msvcrt.LK_NBLCK,1)
                    else:
                        import fcntl
                        fcntl.flock(stream.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
                    break
                except (OSError,BlockingIOError):
                    notify();time.sleep(.2)
            try: yield
            finally:
                stream.seek(0)
                if os.name=='nt':
                    import msvcrt
                    msvcrt.locking(stream.fileno(),msvcrt.LK_UNLCK,1)
                else:
                    import fcntl
                    fcntl.flock(stream.fileno(),fcntl.LOCK_UN)

    def read(self,start,end):
        with self.connect() as db:
            rows=db.execute('SELECT p.start,p.end,o.price,o.provenance,o.hash FROM prices p JOIN observations o ON o.hash=p.hash WHERE p.end>? AND p.start<? ORDER BY p.start',(int(start.timestamp()),int(end.timestamp()))).fetchall()
        return [dict(timestamp_utc=dt.datetime.fromtimestamp(a,UTC),end_timestamp_utc=dt.datetime.fromtimestamp(b,UTC),price_eur_mwh=p,provenance=json.loads(meta),interval_hash=h) for a,b,p,meta,h in rows]

    def gaps(self,start,end):
        cursor=start;gaps=[]
        with self.connect() as db:
            bounds=db.execute('SELECT start,end FROM prices WHERE end>? AND start<? ORDER BY start',(int(start.timestamp()),int(end.timestamp()))).fetchall()
        for a,b in bounds:
            left,right=dt.datetime.fromtimestamp(a,UTC),dt.datetime.fromtimestamp(b,UTC)
            if left>cursor: gaps.append((cursor,min(left,end)))
            cursor=max(cursor,right)
        if cursor<end: gaps.append((cursor,end))
        return gaps

    def put(self,rows,refresh=False):
        normalized=[]
        for row in rows:
            a,b=row['timestamp_utc'],row['end_timestamp_utc'];p=float(row['price_eur_mwh'])
            if not a.tzinfo or not b.tzinfo or b<=a or a.microsecond or b.microsecond or not math.isfinite(p):
                raise PriceDataError('INVALID_RESPONSE','Invalid UTC price interval or non-finite price.')
            a,b=int(a.timestamp()),int(b.timestamp());meta=row['provenance']
            if meta.get('market_area')!='AT' or meta.get('market')!='day_ahead' or meta.get('unit')!='EUR/MWh' or meta.get('license')!='CC BY 4.0' or meta.get('source_resolution_seconds')!=b-a or a%(b-a):
                raise PriceDataError('INVALID_RESPONSE','Expected licensed AT day-ahead raw prices in EUR/MWh.')
            h=hashlib.sha256(json.dumps([a,b,p,meta],sort_keys=True).encode()).hexdigest()
            normalized.append((a,b,p,json.dumps(meta,sort_keys=True),h))
        normalized.sort()
        if any(a[1]>b[0] for a,b in zip(normalized,normalized[1:])):
            raise PriceDataError('INVALID_RESPONSE','Source contains overlapping or duplicate intervals.')
        added=conflicts=0
        with self.connect() as db:
            db.execute('BEGIN IMMEDIATE')
            for a,b,p,meta,h in normalized:
                db.execute('INSERT OR IGNORE INTO observations VALUES(?,?,?,?,?)',(h,a,b,p,meta))
                old=db.execute('SELECT p.start,p.end,o.price,p.hash FROM prices p JOIN observations o ON o.hash=p.hash WHERE p.end>? AND p.start<?',(a,b)).fetchall()
                for x,y,q,old_hash in old:
                    if x!=a or y!=b or abs(q-p)>1e-9:
                        conflicts+=1
                        db.execute('INSERT OR IGNORE INTO conflicts VALUES(?,?,?)',(old_hash,h,dt.datetime.now(UTC).isoformat()))
                if old and not refresh: continue
                if old and any(x<a or y>b for x,y,_,_ in old):
                    # Do not split a selected original interval implicitly.
                    continue
                if refresh: db.execute('DELETE FROM prices WHERE end>? AND start<?',(a,b))
                db.execute('INSERT OR REPLACE INTO prices VALUES(?,?,?)',(a,b,h));added+=1
        return dict(inserted=added,conflicts=conflicts)

    def conflicts(self):
        with self.connect() as db:
            rows=db.execute('''SELECT c.old_hash,c.new_hash,c.detected_at,a.start,a.end,a.price,a.provenance,b.start,b.end,b.price,b.provenance
              FROM conflicts c JOIN observations a ON a.hash=c.old_hash JOIN observations b ON b.hash=c.new_hash
              ORDER BY c.detected_at DESC LIMIT 100''').fetchall()
        return [dict(code='PROVIDER_PRICE_CONFLICT',old_hash=a,new_hash=b,detected_at=t,
                selected_before=dict(start_utc=x,end_utc=y,price_eur_mwh=p,provenance=json.loads(m)),
                incoming=dict(start_utc=u,end_utc=v,price_eur_mwh=q,provenance=json.loads(n))) for a,b,t,x,y,p,m,u,v,q,n in rows]


def announce_price_store():
    store=PriceStore();info=store.persistence()
    logging.getLogger('uvicorn.error').info('Historical price cache: %s',info['path'])
    for warning in info['warnings']: logging.getLogger('uvicorn.error').warning(warning)
