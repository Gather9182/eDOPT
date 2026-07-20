import pandas as pd

df = pd.DataFrame({
    'Umlauf': ['W1', 'W1', 'W2'], 
    'Betriebstage': ['Alle Mo-Fr']*3, 
    'Planungsbedingung': ['OSchule']*3, 
    'Typ': ['A', 'E', 'A'], 
    'von': ['STATION', 'OWELS_A', 'STATION'], 
    'Startzeit': ['08:00', '10:00', '09:00'], 
    'nach': ['OWELS_E', 'STATION', 'OWELS_E'], 
    'Endzeit': ['08:30', '10:30', '09:30'], 
    'Dauer': ['00:30', '00:30', '00:30']
})

with pd.ExcelWriter('test_umlauf.xlsx') as writer:
    df.to_excel(writer, sheet_name='Tabelle1', index=False)

print("test_umlauf.xlsx created with sheet 'Tabelle1'")
