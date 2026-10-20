# Umsetzungsplan: Short-Term-vergleichbare Long-Term-Auswertung

Stand: 20.10.2026. Grundlage: Nutzerdatei
`CODEX_eDOPT_Minimaler_Longterm_Shortterm_Vergleich.md` und Prüfung des aktuellen Codes.
Dieses Dokument hält die ursprüngliche Bewertung und den Umsetzungsplan fest.
Der anschließend implementierte Stand und seine Grenzen stehen in
[longterm-shortterm-implementation.md](longterm-shortterm-implementation.md).

## Bewertung und empfohlener Umfang

Der Vorschlag ist fachlich sinnvoll. Der bestehende 24h-Solver lässt sich
wiederverwenden; eine Aufhebung sämtlicher Long-Term-Sperren allein wäre falsch.
Für einen belastbaren Vergleich sind Preisabdeckung, gleiche Eingaben,
Mitternachtszustände und belegbare Tagesergebnisse gemeinsam notwendig.

Empfohlene erste Lieferung:

- Bestehendes `Flexible / Rolling Horizon` mit 24/48/72h erhalten.
- Zusätzlicher Modus `Repeat timetable / Daily Cyclic`, zunächst nur Baseline
  und 24h pro Kalendertag. Keine automatische Umstellung eines PV/BESS-Szenarios.
- Ein vom Nutzer konfigurierter Tagesfahrplan wird täglich wiederholt;
  das ist weder ein Kalenderfahrplan noch eine gemeinsame Mehrtagesoptimierung.
- Vorhandene Ladekurve, Standortgrenzen, automatische/optimierte Sperrzeitregeln,
  SoC-Modi und manuelle Routenausschlüsse unverändert übernehmen.
- Täglich Bus-SoC-Gleichheit prüfen; die Anschlussbelegung physisch fortschreiben.
- Für den neuen Modus echte, vollständig belegte historische Preise verlangen.
- Nicht unterstützte Tagesgrenzen ausdrücklich melden; keine versteckten Ersatzwerte.

Die P0-Einstufung passt für die Korrektheit dieses Vergleichs. Eine neue
Referenzverwaltung, Kalenderfahrpläne, PV/BESS-Erweiterungen und ein generischer
48/72h-Solver mit täglichen Gleichheiten sind dafür nicht erforderlich.

## Im Code bestätigte Punkte

| Bereich | Aktueller Befund | Konsequenz |
|---|---|---|
| Moduswahl | `socPolicy.js` und `OptimizationRun.jsx` sperren tägliche Zyklik in Long-Term. | Einen ausdrücklich getrennten Modus hinzufügen. |
| Backend | `models.py` erlaubt Zyklik bereits für einzelne vollständige 24h-Requests. | Die 24h-Prüfung beibehalten; tägliche Requests statt beliebiger Mehrtages-Zyklik. |
| Eingaben | Short-Term- und Long-Term-Builder sind getrennt. Long-Term setzt globale Metadaten auf 1.0/0.2, während Buswerte anders sein können. | Gemeinsamen Builder und konsistente Metadaten verwenden. Das beweist noch keinen falschen tatsächlichen Bus-Startwert. |
| Preise | Short-Term verwendet Tarifannahmen; Long-Term setzt Markt- und Solverpreise auf dieselbe Reihe. | Eine gemeinsame Effektivpreisfunktion einsetzen. |
| Datenlücken | `price_service.py` und der Long-Term-Frontendpfad können fehlende Daten durch alte, wiederholte oder Nullwerte ersetzen. | Für belegte historische Auswertungen strikt validieren. |
| Anschlussgrenzen | Zyklische Anschlussbedingungen sind teilweise an `initial_connection_site is None` gebunden. Long-Term übergibt Folgezustände, initialisiert Tag 1 aber mit einer leeren Anschlussmap. | Definierte Anfangszustände erhalten und Tagesschnitte explizit prüfen. `cyclic_connections=true` allein ist kein Nachweis. |
| Zeitangaben | Optionale Fahrtzeiten enthalten im Solver bereits `horizon_start_minute`; Long-Term addiert den Chunk-Offset nochmals. | Eine eindeutige Zeitbasis und genau eine Umrechnung festlegen. |
| Tagesdiagnosen | Die Diagnose kann Next-Day-Energie unabhängig vom aktiven Toggle addieren; `fraction || 0.2` ersetzt auch eine gewählte Reserve von 0. | Diagnose aus tatsächlichem Request/Endmodus ableiten; 0 als gültigen Wert erhalten. |
| Vergleichskosten | Fehlende Referenz-/Vergleichskosten werden teilweise durch `|| 0` summiert. | Fehlende Vergleiche als nicht verfügbar ausweisen, nicht als kostenlose Referenz. |
| Fehlerfolge | Bei einem späteren Fehler entsteht derzeit kein sauber gespeichertes partielles Gesamtergebnis. | Tagesergebnisse vor dem nächsten Solve sichern. |
| Wiederverwendung | Live-Job-API, genaue Request-Archive, Standortprofile und ZIP-Export sind bereits vorhanden. | Diese Infrastruktur erweitern, keine zweite Solver-/Exportarchitektur bauen. |

## Umsetzung in vier überprüfbaren Schritten

### 1. Gemeinsame Konfiguration und Preisfunktion — zuerst

Aus `OptimizationRun.jsx` kleine, testbare Hilfsfunktionen auslagern:

- Nutzerkonfiguration zu Beginn des Laufs als unveränderlichen Snapshot erfassen.
- Aktive Bus-IDs ausschließlich aus den gespeicherten Nutzer-Ausschlüssen bestimmen.
- Fahrzeugdaten, tatsächliche Startenergien, Endreserven, Standortregeln,
  Sperrzeitmodus und Ladekurve zentral zu Solver-Eingaben auflösen.
- Bestehende globale Nutzerwerte und echte explizite Bus-Overrides nach derselben
  Regel wie im Short-Term auflösen. Rohe Importwerte nicht versehentlich als neue
  Overrides interpretieren. Falls deren Herkunft nicht unterscheidbar ist, diese
  Unklarheit vor einer Änderung der Vorrangregel lösen.
- Gemeinsame Funktion für Marktpreis -> Effektivpreis mit den aktuell gewählten
  Gebühren, Steuern und dem USt-Schalter. Bestehende Einstellungen nicht ersetzen.
- Globale Konfigurationsdefaults und tatsächlich fortgeschriebene Buszustände im
  Export klar unterscheiden; keine falschen 1.0/0.2-Metadaten.

Abnahme: Ein 24h-Request aus beiden Wegen enthält dieselben technischen
Eingaben und dieselben Kostenannahmen. Ausschließlich explizite Lauf-/Tagesfelder
dürfen abweichen. Short-Term-Regressionen müssen bestehen.

### 2. Strikte historische Tagespreise

Einen klar getrennten strikten Preisabruf für den neuen Vergleichsmodus ergänzen:

- Pro lokalem Kalendertag Start-/Endgrenze in `Europe/Vienna` bestimmen und in UTC
  abbilden. Quellintervalle mit Anfang und Ende aufbewahren.
- Lücken, Überlappungen, Dubletten, ungültige Werte und unvollständige Abdeckung
  prüfen. Preise aus tatsächlich abgedeckten Quellintervallen zuordnen;
  gegebenenfalls zeitgewichtet auf das ausgewählte Raster abbilden.
- Negative oder echte Nullpreise sind gültig; fehlende Preise sind etwas anderes.
- Marktpreise, Effektivpreise, Zeitstempel, Zeitzone und Herkunft gemeinsam liefern.
- Keine Day-1-/Vortags-/Nullauffüllung in diesem Modus, auch nicht zusätzlich im Frontend.
- Minimal: lokale 23h-/25h-Zeitumstellungstage vorab mit genauer Datumsangabe ablehnen.
  Keine künstliche Erzeugung von 96 Viertelstunden für solche Tage.
- Baseline benötigt keinen Wetter-/PV-Abruf. Den bestehenden Historical-Context-
  Pfad für flexible PV/BESS-Läufe nicht unnötig umbauen.

Abnahme: Ein unvollständiger Tag wird nicht mit erfundenen Preisen optimiert.
Normale Tage haben genau die geforderte, belegte Rasterabdeckung.

### 3. Daily-Cyclic-Orchestrierung und betriebliche Tagesgrenze

- UI-Auswahl zwischen flexiblem Rolling Horizon und Daily Cyclic.
- Im neuen Modus ausschließlich 24h-Requests; vorhandene Backend-Schutzprüfung
  für 24h und die gegenseitige Ausschließlichkeit der Endbedingungen beibehalten.
- Der bewusst gewählte Daily-Cyclic-Modus setzt für seine Requests
  `use_cyclic_soc=true`, `use_next_day_readiness=false`. Andere Einstellungen
  bleiben unverändert. Den flexiblen Modus nicht nebenbei umkonfigurieren.
- Bestehende Live-Job-API täglich sequenziell aufrufen und Datum/Tag X von Y
  zusätzlich zum aktuellen Solver-Durchlauf anzeigen.
- Im Tagesmodus bevorzugt lokale Solver-Minuten 0..1440 verwenden. Datum und
  globalen Ergebnisoffset separat speichern und beim Zusammenführen einmalig
  anwenden. Rohrequests/-antworten unverändert archivieren.
- Vor dem Folgetag SoC-Ende gegen tatsächlichen Tagesstart UND konfigurierte
  zyklische Startenergie prüfen, mit bestehender Toleranz 0.001 kWh.
  Kein Zurücksetzen nach einem unzulässigen oder ungeprüften Ergebnis.
- Explizite Anschlusszustände an Tag 1 erhalten; danach End-Anschlüsse an den
  nächsten Request übergeben. Abfahrten, neue Ankünfte, Sperrzeiten und
  `automatic_balanced` müssen auch über Mitternacht gelten.
- Tägliche SoC-Gleichheit und Anschlusskontinuität sind verschiedene Bedingungen.
  Nicht ungefragt zusätzlich identische Anfangs-/End-Anschlussmuster für jeden
  Tag erzwingen. Bestehende zyklische Anschlussregeln müssen mit explizit
  übergebenen Zuständen geprüft und korrekt abgegrenzt werden.

**Wichtige Umfangsgrenze:** Eine optionale Ladefahrt kann über Mitternacht laufen.
Dann reichen SoC und belegter Ladeort als Übergabezustand nicht aus; Hin-/Rückfahrt,
Ladebesuch und Restfahrzeit gehören ebenfalls dazu. Empfehlung für die minimale
erste Lieferung: solche Tagesgrenzen ausdrücklich als nicht unterstützt melden,
statt Optionen still zu löschen oder Tage fiktiv zu entkoppeln. Soll diese
Konfiguration zwingend unterstützt werden, ist die erweiterte Besuchszustands-
Übergabe zusätzlicher Pflichtumfang. Fest geplante Tagesfahrten bleiben erhalten.

Abnahme: Ein Tag mit identischem vollständigem Input entspricht Short-Term in
Zulässigkeit, Endbedingungen und optimalen Kosten innerhalb Toleranz.
Alternative gleichwertige Ladepläne sind zulässig. Eine mitgeführte reale
Anschlussbelegung kann spätere Tage gegenüber einem isolierten Vergleich mit
frei gewähltem Anfangsanschluss einschränken; dies ist kein Parameterfehler.

### 4. Tagesbelege, Aggregation, Teilergebnisse und Export

- Vor jedem nächsten Solve Tagesrequest, Preise und Ergebnis in der vorhandenen
  IndexedDB-/Request-Archivstruktur sichern. Nicht auf flüchtige Backend-Jobs vertrauen.
- Je Tag Datum, Betriebsart, eingeschlossene Bus-IDs, Status, Request-Verweis,
  Endbedingung, SoC-/Anschlussübergang und Standortprofile ablegen.
- Kosten mit `Summe(Netzbezug_kW * dt_h * Effektivpreis_EUR_MWh / 1000)`
  gegenrechnen; Energie konsistent aus den Profilen summieren. Für Vergleiche
  Netzenergie und Batterieenergie klar auseinanderhalten.
- Maximalleistung als Maximum der Tagesprofile, keine Summe von Tagesmaxima.
- Soft-Abweichungen und tägliche Endbedingungen vollständig zusammenführen.
- Tagesdiagnosen aus tatsächlich verwendeten Endbedingungen berechnen; keine
  bedingungslose Next-Day-Anforderung und keine Ersetzung einer Reserve von 0.
- Absolute/relative Fahrtzeiten und Tagesfilter vereinheitlichen; doppelte
  Offsetaddition und fehlende Zusatzfahrten in späteren Tagesdiagnosen korrigieren.
- Vergleichskosten nur aggregieren, wenn die relevanten Referenzen verfügbar
  und zulässig sind. Andernfalls `not available`, niemals Nullkosten als Ersatz.
- Fehler an Tag N: abbrechen, Tag N mit Fehler und Resttage als nicht berechnet
  ausweisen. Erfolgreiche Vortage als `partial` speichern und exportierbar halten.
  Weder Gesamt-success noch automatische Routenexklusion.
- ZIP mit Tagesübersicht, Original-/Effektivpreisen samt Zeitstempeln,
  täglichen Endnachweisen und unveränderten Request-/Ergebnisdateien ergänzen.
- Hinweis in UI und Export: täglich wiederholter Nutzerfahrplan; keine
  Wochenend-/Feiertagsvariation und kein globales Mehrtageskostenoptimum.

## Pflichtabnahmen vor Freigabe

1. Ein Tag: identische aufgelöste Konfiguration und Preisreihe -> gleiche
   Zulässigkeit, Endbedingungen und optimale Kosten wie Short-Term.
2. Zwei Tage: unterschiedliche Preise, richtige Effektivkosten und täglicher
   SoC-Nachweis; dieselbe Nutzerflotte und technische Konfiguration.
3. Konfigurationserhalt: verschiedene Flottengrößen, gespeicherte Ausschlüsse,
   globale Startwerte/echte Bus-Overrides, Reserve 0, Hard/Soft/Off, Standort- und
   Sperrzeitmodus, Ankunftsausnahme im optimierten Modus sowie Ladekurve.
4. Mitternacht: belegter Anschluss, unbekannter/bekannter Anfangszustand,
   Abfahrt, Ankunft im Sperrfenster und automatische gleichmäßige Ladung.
5. Preisabdeckung: echte Null-/Negativpreise, Lücke, Dublette, falsche Reihenfolge
   und DST-Tag; keine unmarkierte Auffüllung.
6. Fehler an Tag 2: Tag 1 exportierbar, Tag 2 diagnostiziert, kein Gesamt-success
   und keine neue Exklusion.
7. Aggregation: Kosten, Energie, Peaks, Tagesgrenzen und optionale Fahrtzeiten
   an Tag 2; unzulässige Referenz bleibt nicht verfügbar.
8. Bestehendes flexibles Long-Term mit 24/48/72h und SoC-/Anschlussfortschreibung
   bleibt nutzbar; bisherige Short-Term-, Ladekurven- und Automatiktests bestehen.

## Reihenfolge und Freigabe

Vier getrennt überprüfbare Änderungen in der obigen Reihenfolge. Kein neuer
Solver, keine neue Referenzverwaltung, keine vollständige DST-Simulation.
Die Punkte 1–4 bilden zusammen die kleinste belastbare Vergleichsfunktion;
ein freigeschalteter Toggle ohne Preise-/Grenz-/Exportkorrekturen ist keine
fertige P0-Lieferung. Konkrete Laufzeit für Wochen/Monate muss nach einem
1- und 2-Tage-Integrationstest gemessen werden: die Funktion spart keine
Solverläufe, sondern führt einen pro Tag aus, gegebenenfalls zweistufig.

## Hauptsächlich betroffene Codebereiche

- Frontend: `pages/OptimizationRun.jsx`, `utils/socPolicy.js`, `utils/charging.js`,
  gemeinsame Request-/Preis-/Tagesergebnis-Helfer, `services/api.js`,
  Ergebnis-/Exportansicht und `utils/resultAnalysisExport.js`.
- Backend: strikter Tagespreis-Service/Endpunkt in `price_service.py`/`main.py`,
  gezielte Grenzprüfungen in `models.py`, `end_conditions.py`, `charging_sites.py`
  und gegebenenfalls optionalen Fahrtzuständen. MILP-Endbedingung wiederverwenden.
- Tests: gemeinsame Eingaben/Preise und Aggregation im Frontend; historische
  Abdeckung, Grenzzustände und Short-/Long-Term-Parität im Backend/Integration.
