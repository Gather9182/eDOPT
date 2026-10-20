# Long-Term / Daily Cyclic: implementierter Stand

Stand: 20.10.2026. Ergänzt den ursprünglichen
[Umsetzungsplan](longterm-shortterm-implementation-plan.md).

Die anschließende optionale Parallelisierung und ihre Randbedingungen sind in
[daily-cyclic-parallelization.md](daily-cyclic-parallelization.md) beschrieben.

## Bedienung und Umfang

In Optimization Engine den Modus **Long-Term / Daily Cyclic** wählen,
**Baseline** sowie Start- und Enddatum einstellen. Run Check prüft die
technischen Eingaben und den Kalender; beim Start werden die historischen
Preise für jeden Tag gesondert geprüft.

Jeder reguläre Kalendertag wird als vollständiger 24-Stunden-Lauf berechnet. Derselbe
konfigurierte Tagesfahrplan wird wiederholt; Wochenenden und Feiertage erhalten
keinen anderen Fahrplan. Es handelt sich um tägliche Optimierungen und nicht
um ein gemeinsames Mehrtagesoptimum.

Short-Term, Flexible Long-Term und Daily Cyclic verwenden einen gemeinsamen
Request-Builder und dieselbe Effektivpreisfunktion. Flotte, manuelle Ausschlüsse,
Ladeorte, Leistungsgrenzen, Ladekurve, SoC-Modi und optionale Fahrten stammen
aus der aktuellen Konfiguration. Es werden keine zusätzlichen Umläufe ausgeschlossen.
Daily Cyclic aktiviert für seine Requests Start-SoC = End-SoC und deaktiviert
Next-Day Readiness, ohne diese gespeicherten Short-Term-Einstellungen zu ändern.

Der tatsächliche End-SoC und Anschlusszustand werden an den Folgetag übergeben.
Profilvollständigkeit, Flotte, tägliche SoC-Gleichheit, Mitternachtsanschlüsse,
Kosten und Energie werden vor dem nächsten Tag geprüft.

## Preise und Grenzen

- Daily Cyclic verlangt vollständig belegte aWATTar-Quellintervalle und speichert
  UTC-Quellintervalle, lokale Zeitstempel, Markt- und Effektivpreise.
- Lücken, Überlappungen, doppelte oder ungültige Preise werden abgelehnt.
  Echte Null- und Negativpreise bleiben erhalten. Es gibt keinen Preisersatz.
- Zeitzone ist Europe/Vienna. Tage mit 23 oder 25 Stunden blockieren den
  Kalender und Run Check nicht mehr: Sie erhalten `skipped` / `Skipped (DST)`
  und werden ohne Preisabruf oder Solve ausgelassen. Keine künstliche 24h-Zuordnung.
  Ergebnisse, Kalender und Analyse-ZIP zeigen Datum, Grund und tatsächliche
  Tagesdauer. Alle Kennzahlen schließen diese Tage aus; es erfolgt keine
  Hochrechnung auf ein vollständiges Jahr. Start- und Enddatum zählen beide mit.
  Beispiel 20.10.2025–20.10.2026: 366 angefragte Tage, zwei DST-Ausnahmen
  (26.10.2025: 25 Stunden; 29.03.2026: 23 Stunden), bis zu 364 Ergebnisse.
  Im gekoppelten seriellen Modus beginnt nach der Lücke ein unabhängiger
  Abschnitt mit konfigurierten Anfangswerten; kein Zustandsübergang über die
  ausgelassene Zeit wird behauptet.
- Zunächst nur Baseline. PV/BESS und optionale Ladeaufenthalte über Mitternacht
  werden in diesem Modus ausdrücklich abgelehnt.
- Der bestehende flexible Modus behält 24/48/72h und seinen bisherigen
  Preis-Fallback. Er wird im Export nicht als streng historisch verifiziert
  gekennzeichnet. Für den belegten historischen Tagesvergleich Daily Cyclic wählen.

## Speicherung, Anzeige und Export

### Einmaliger Retry für Preisdatenfehler

Die standardmäßig aktivierte Checkbox **Retry failed historical-price days
after all dates** startet nach dem ersten vollständigen Datumsdurchlauf einen
zusätzlichen seriellen Versuch für Tage, die vor Erstellung eines Solverrequests
gescheitert sind. Erfolgreiche Tage, Solverfehler und DST-Ausschlüsse werden nicht
erneut berechnet. Pro betroffenem Datum gibt es höchstens einen weiteren Abruf
mit den eingefrorenen Einstellungen. Weiterhin unvollständige Preise bleiben
Fehler; es gibt keinen Preisersatz.

Ein wiederhergestellter Tag muss die ursprünglichen täglichen SoC-Ziele,
gegebenenfalls die festen Parallel-Mitternachtsgrenzen sowie Anschlüsse und SoC
zu beiden bereits vorhandenen Nachbartagen erfüllen. Erfolgreiche Nachbartage
werden nicht verändert. Ein Abbruch stoppt weitere Retry-Versuche und behält
die schon vorhandenen Ergebnisse. Results und ZIP dokumentieren Retry-Zähler,
ursprüngliche Fehlversuche (`attempt_history`) und neue Ergebnisse. Diese
automatische Phase gilt für neue Läufe; sie startet keine nachträgliche
Berechnung beim bloßen Öffnen älterer gespeicherter Ergebnisse.

Jeder erfolgreiche Tag wird vor dem nächsten Solve in IndexedDB gespeichert,
einschließlich Request, Preisen und Ergebnis. Bei einem späteren Fehler bleiben
abgeschlossene Tage als Teilergebnis verfügbar; fehlerhafte und noch nicht
berechnete Tage werden getrennt ausgewiesen und fehlen in den Summen.

Results und Export zeigen eine einklappbare Tagesübersicht, bei Teilergebnissen
zusätzlich einen sichtbaren Warnhinweis. Die Analyse-ZIP enthält Tagesstatus,
Einzelrequests, Preisbelege, Rohresultate, Tageskostentabelle und SoC-/Anschlussnachweise.
Kosten und Energiemengen werden aus den Tagesprofilen gegengerechnet. Der Solver
serialisiert Kosten und MWh mit sechs Dezimalstellen, damit Rundung auf Cent
beziehungsweise 0,001 MWh die Mehrtagessummen nicht verfälscht. Die UI rundet zur Anzeige.

Im flexiblen Modus wurden außerdem die doppelte Zeitverschiebung optionaler
Fahrten, pauschale SoC-Metadaten, eine ignorierte Nullreserve und künstliche
Nullkosten bei nicht verfügbaren Referenzen korrigiert.

## Prüfung

Automatisierte Tests decken Preisabdeckung, DST-Ausschlüsse, Konfigurationserhalt,
Short-Term-/Daily-Parität, Tagesübergänge, Kostenabgleich, Export und Fehler an
Tag 2 ab. Zusätzlich wurde der vollständige Job-API-Pfad mit echten MILP-Solves,
zwei Standorten, Ladekurve und Sperrzeiten geprüft. Dafür wurden kontrollierte
historische Preisdatensätze verwendet; dies ist kein Verfügbarkeitsnachweis des
externen aWATTar-Dienstes für einen beliebigen Zeitraum.

Zusätzlich werden vollständige 365-Tage-Orchestrierungsläufe mit kontrollierten
Solver-/Preisantworten seriell und mit vier Workern geprüft: genau 363
Ergebnistage, zwei getrennt markierte DST-Ausnahmen, korrekte Summen und
Exportbelege. Dies ist kein Jahreslauf mit echten MILP-Solves oder externen Preisen.
