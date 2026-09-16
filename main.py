import os, io, re, pickle, datetime, unicodedata
import pandas as pd
import numpy as np
from flask import Flask, request, jsonify, send_file, send_from_directory
from werkzeug.exceptions import HTTPException

app = Flask(__name__, static_folder='static', static_url_path='/static')
app.json.sort_keys = False

JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
BASE_COLS = ['TRANSPORT', 'WORKDAY ID', 'Paid ID', 'Nom', 'Projet', 'Statut']
COLONNES_OBLIGATOIRES = BASE_COLS
# Deux blocs uniquement : HORS PROD (ex-PRESTA + SUPPORT + SAI) et PROD / PLANIFIÉ PROD
ENTITES = ["HORS PROD", "PROD / PLANIFIÉ PROD"]
ENTITES_MAIN = ENTITES
ENTITY_COLORS = {"HORS PROD": "#2E75B6", "PROD / PLANIFIÉ PROD": "#548235"}
DATA_FILE = 'logiplan_state.pkl'

# ================= RÈGLES MÉTIER ENTITÉ =================
# Préfixe commençant par « W » ou égal à « ST » -> PROD ; tout le reste -> HORS PROD
PROD_PREFIXES = ("W", "ST")

def alpha_prefix(mat):
    """Lettres initiales du matricule : W00292->'W', WL0001->'WL', ST2015->'ST', SAI-01->'SAI'."""
    m = re.match(r'^[A-Z]+', str(mat).strip().upper())
    return m.group(0) if m else ""

def entity_for(mat):
    p = alpha_prefix(mat)
    return "PROD / PLANIFIÉ PROD" if (p.startswith("W") or p == "ST") else "HORS PROD"

def is_prod_entity(ent):
    return ent == "PROD / PLANIFIÉ PROD"

# ================= NORMALISATION DES IDENTIFIANTS =================
def clean_id(x):
    try:
        if x is None: return ""
        if isinstance(x, float):
            if x != x: return ""
            x = int(x) if x == int(x) else x
        s = str(x).strip().upper()
        return "" if s in ('NAN', 'NONE', '<NA>', 'NULL', 'NAT') else s
    except Exception:
        return ""

def safe_paid_ids(df):
    out = set()
    if not isinstance(df, pd.DataFrame) or 'Paid ID' not in df.columns:
        return out
    for x in df['Paid ID'].tolist():
        s = clean_id(x)
        if s: out.add(s)
    return out

# ================= ÉTAT PERSISTANT =================
def load_state():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, 'rb') as f:
                s = pickle.load(f)
            if not isinstance(s, dict): s = {}
        except Exception:
            s = {}
    else:
        s = {}
    if not isinstance(s.get('plannings'), dict): s['plannings'] = {}
    if not isinstance(s.get('commandes'), dict): s['commandes'] = {}
    if not isinstance(s.get('calculs'), dict): s['calculs'] = {}
    if not isinstance(s.get('current_week'), (str, type(None))): s['current_week'] = None
    ref = s.get('reference')
    if ref is not None and not isinstance(ref, pd.DataFrame): s['reference'] = None
    return s

STATE = load_state()

def save_state():
    try:
        with open(DATA_FILE, 'wb') as f:
            pickle.dump(STATE, f)
    except Exception:
        pass

def planning_valide(df):
    return (isinstance(df, pd.DataFrame) and not df.empty
            and all(c in df.columns for c in COLONNES_OBLIGATOIRES))

def current_data():
    week = STATE.get('current_week')
    pl = STATE['plannings'].get(week)
    cmd = STATE['commandes'].get(week)
    if not planning_valide(pl): pl = None
    if not isinstance(cmd, pd.DataFrame) or cmd.empty: cmd = None
    return week, pl, cmd

def get_presta_effectifs(week):
    """Prestataires (Hors Planning) saisis sur la page Effectifs (stockés au calcul)."""
    calc = STATE['calculs'].get(week) if week else None
    if isinstance(calc, dict) and isinstance(calc.get('presta'), dict):
        return calc['presta']
    return None

def _to_float(v, default=0.0):
    try:
        if v is None: return float(default)
        f = float(v)
        return f if f == f else float(default)
    except Exception:
        return float(default)

def _to_int(v, default=0):
    try:
        if v is None: return int(default)
        return int(float(v))
    except Exception:
        return int(default)

# ================= FONCTIONS UTILITAIRES =================
def is_planned(val):
    if pd.isna(val) or isinstance(val, bool): return False
    if isinstance(val, (int, float, np.number)): return val > 0
    if isinstance(val, (datetime.time, datetime.datetime, pd.Timestamp)):
        t = val.time() if isinstance(val, (datetime.datetime, pd.Timestamp)) else val
        return t != datetime.time(0, 0, 0)
    val_str = str(val).strip()
    if val_str in ['', '*', 'nan', 'None', '0', '0:00', '00:00', '0:00:00', '00:00:00']: return False
    try:
        dt = pd.to_datetime(val_str, errors='coerce')
        if not pd.isna(dt): return dt.time() != datetime.time(0, 0, 0)
    except: pass
    try: return float(val_str) > 0
    except: pass
    if any(c.isalpha() for c in val_str): return False
    return False

def get_time_obj(val):
    if pd.isna(val) or str(val).strip() in ['', '*', 'nan']: return None
    if isinstance(val, datetime.time): return val
    if isinstance(val, (datetime.datetime, pd.Timestamp)): return val.time()
    if isinstance(val, (int, float, np.number)) and not isinstance(val, bool):
        if 0 < val < 1:
            s_ = int(val * 86400)
            return datetime.time(s_ // 3600, (s_ % 3600) // 60, s_ % 60)
        try:
            dt = pd.to_datetime(val, errors='coerce')
            if not pd.isna(dt): return dt.time()
        except: pass
    val_str = str(val).strip()
    if val_str in ['0', '0:00', '00:00', '0:00:00', '00:00:00']: return None
    try:
        dt = pd.to_datetime(val_str, errors='coerce')
        if not pd.isna(dt): return dt.time()
    except: pass
    return None

def get_pause_start(val):
    if pd.isna(val) or str(val).strip() in ['', '*', 'nan', 'None', '0', '0:00', '00:00', '0:00:00', '00:00:00']: return None
    if isinstance(val, datetime.time): return val
    if isinstance(val, (datetime.datetime, pd.Timestamp)): return val.time()
    val_str = str(val).strip()
    if '-' in val_str: val_str = val_str.split('-')[0].strip()
    try:
        dt = pd.to_datetime(val_str, errors='coerce')
        if not pd.isna(dt): return dt.time()
    except: pass
    return None

def format_time_display(val):
    t = get_time_obj(val)
    if t: return t.strftime('%H:%M')
    return str(val).strip() if not pd.isna(val) and str(val).strip() not in ['nan'] else ""

def get_planning_status(de, a):
    if is_planned(de): return "Planifié"
    val_str = str(de).upper() if not pd.isna(de) else ""
    if 'CONGE' in val_str or 'CONGÉ' in val_str or 'MATERNITÉ' in val_str or 'MALADIE' in val_str: return "CONGE"
    if 'OFF' in val_str or 'LIBRE' in val_str or 'REPOS' in val_str: return "LIBRE"
    if 'DISPO' in val_str: return "DISPONIBILITE"
    if val_str in ['', '*', 'NAN', '0:00', '0:00:00']: return ""
    return val_str

def is_absence_command(cmd_val):
    if pd.isna(cmd_val): return False
    return 'JE NE SERAI PAS' in str(cmd_val).strip().upper()

def calculate_slots(de, a, pause_start):
    if not de or not a: return []
    slots = []
    de_h = de.hour; a_h = a.hour
    if a.minute > 0 or a.second > 0: a_h += 1
    if a <= de:
        for h in range(de_h, 24): slots.append((0, h))
        for h in range(0, a_h): slots.append((1, h))
    else:
        for h in range(de_h, a_h): slots.append((0, h))
    if pause_start:
        slots = [s for s in slots if s[1] != pause_start.hour]
    else:
        slots = [s for s in slots if s[1] != (de_h + 4) % 24]
    return slots

# ================= HELPERS PAGE 6 =================
VALEURS_NON_MENU = {"LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI", "DIMANCHE",
                    "SHIFT", "WKD", "MENU", "CHOIX", "NOMS", "NOM", "PRENOMS", "PRÉNOMS", "PRENOM",
                    "PRÉNOM", "PROJETS", "PROJET", "DEPARTEMENT", "DÉPARTEMENT", "DEPT", "CHECK",
                    "UNIQUE", "CODE", "MATRICULE", "VOTRE MATRICULE", "", "*", "NAN", "NONE", "0"}

def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFD", str(s)) if unicodedata.category(c) != "Mn")

def is_absence_label(val):
    if pd.isna(val): return False
    s = strip_accents(str(val)).upper()
    return ("NE SERAI PAS" in s) or (s.strip() in ("ABSENT", "ABSENTE", "ABSENCE"))

def clean_menu_label(val):
    if pd.isna(val): return None
    s = " ".join(str(val).split())
    if s.upper() in VALEURS_NON_MENU: return None
    if is_absence_label(s): return None
    return s

def derive_week_dates(week_key):
    try:
        m = re.search(r"S(\d{1,2})", str(week_key).upper())
        if not m: return {}
        wk = int(m.group(1))
        if not 1 <= wk <= 53: return {}
        year = datetime.datetime.now().year
        for y in (year, year - 1, year + 1):
            try:
                monday = datetime.date.fromisocalendar(y, wk, 1)
                return {JOURS[i]: monday + datetime.timedelta(days=i) for i in range(7)}
            except ValueError:
                continue
    except Exception:
        pass
    return {}

def compute_recap_menus(planning_df, cmd_df, jours, taux_by_day, presta_effectifs):
    """Logique Recap (2 blocs) :
    - Entité : préfixe commençant par « W » ou « ST » -> PROD ; tout le reste -> HORS PROD.
    - HORS PROD : Planifié = « Prestataires (Hors Planning) » de la page Effectifs.
      PROD : Planifié = planifiés du planning (préfixes ST/W).
    - Nombres = commandes du jour (les PROD non planifiées ne sont pas comptées).
    - SANS CHOIX = Planifié − total des menus (inclut les « Je ne serai pas présent »).
    - À commander = Nombres × (1 − absence prévue) pour PROD uniquement ; HORS PROD = Nombres.
    - Total (Nombres) = Planifié, dans tous les cas."""
    # Planifiés PROD depuis le planning
    planned_prod = {j: set() for j in jours}
    if planning_df is not None and not planning_df.empty:
        p = planning_df.copy()
        p["Paid ID"] = p["Paid ID"].apply(clean_id)
        p = p[p["Paid ID"] != ""]
        p["Entite"] = p["Paid ID"].apply(entity_for)
        for j in jours:
            if f"{j}_Flag" in p.columns:
                g = p[(p[f"{j}_Flag"] == 1) & (p["Entite"] == "PROD / PLANIFIÉ PROD")]
                planned_prod[j] |= set(g["Paid ID"])
    # Planifiés HORS PROD depuis la page Effectifs
    presta = presta_effectifs or {}
    planned_horsprod = {j: _to_int(presta.get(j, 0)) for j in jours}

    # Commandes par jour
    melted = pd.DataFrame()
    if cmd_df is not None and not cmd_df.empty:
        c = cmd_df.copy()
        c["Paid ID"] = c["Paid ID"].apply(clean_id)
        c = c[c["Paid ID"] != ""]
        day_cols = [j for j in jours if j in c.columns]
        if day_cols:
            melted = c.melt(id_vars=["Paid ID"], value_vars=day_cols, var_name="Jour", value_name="Brut")
            melted = melted[melted["Brut"].notna()].copy()
            melted["Brut"] = melted["Brut"].astype(str).str.strip()
            melted = melted[melted["Brut"] != ""]
            melted["Entite"] = melted["Paid ID"].apply(entity_for)
            melted["Menu"] = melted["Brut"].apply(clean_menu_label)
            # Règle : PROD non planifié ce jour => non comptabilisé (HORS PROD toujours compté)
            keep = melted.apply(
                lambda r: (r["Entite"] != "PROD / PLANIFIÉ PROD")
                          or (r["Paid ID"] in planned_prod.get(r["Jour"], set())), axis=1)
            melted = melted[keep]

    menus_cnt, day_menu_totals = {}, {}
    if not melted.empty:
        for (j, ent, mn), g in melted[melted["Menu"].notna()].groupby(["Jour", "Entite", "Menu"]):
            menus_cnt[(j, ent, mn)] = len(g)
            day_menu_totals.setdefault(j, {})
            day_menu_totals[j][mn] = day_menu_totals[j].get(mn, 0) + len(g)

    recap, day_totals = {}, {}
    for j in jours:
        menu_list = [m for m, _ in sorted(day_menu_totals.get(j, {}).items(), key=lambda kv: (-kv[1], kv[0]))]
        taux = _to_float(taux_by_day.get(j, 0))
        for ent in ENTITES:
            is_prod = is_prod_entity(ent)
            facteur = (1.0 - taux / 100.0) if is_prod else 1.0
            planned = len(planned_prod[j]) if is_prod else planned_horsprod[j]
            ent_menus = [(m, menus_cnt.get((j, ent, m), 0)) for m in menu_list]
            total_menus = sum(n for _, n in ent_menus)
            sans_choix = planned - total_menus
            rows = []
            for m, n in ent_menus:
                rows.append({"Choix": m, "Nombres": n,
                             "Pourcentage": (n / planned * 100) if planned else 0.0,
                             "À commander": int(n * facteur + 0.5)})
            rows.append({"Choix": "SANS CHOIX", "Nombres": sans_choix,
                         "Pourcentage": (sans_choix / planned * 100) if planned else 0.0,
                         "À commander": int(sans_choix * facteur + 0.5)})
            total_ac = sum(r["À commander"] for r in rows)
            rows.append({"Choix": "TOTAL", "Nombres": planned,
                         "Pourcentage": 100.0 if planned else 0.0, "À commander": total_ac})
            abs_prevues = int(round(planned * taux / 100.0)) if is_prod else 0
            recap[(j, ent)] = {"df": pd.DataFrame(rows), "planned_n": planned,
                               "sans_choix": sans_choix, "abs_prevues": abs_prevues,
                               "total_n": planned, "total_ac": total_ac}
        day_totals[j] = sum(recap[(j, e)]["total_ac"] for e in ENTITES_MAIN)
    return recap, day_totals

# ================= SÉRIALISATION =================
def jsonable(v):
    try:
        if v is None or v is pd.NaT: return None
        if isinstance(v, bool): return bool(v)
        if isinstance(v, int): return int(v)
        if isinstance(v, float): return None if v != v else float(v)
        if isinstance(v, str): return v
        if isinstance(v, np.bool_): return bool(v)
        if isinstance(v, np.integer): return int(v)
        if isinstance(v, np.floating):
            f = float(v); return None if f != f else f
        if isinstance(v, datetime.time): return v.strftime('%H:%M')
        if isinstance(v, datetime.timedelta): return str(v)
        if isinstance(v, (datetime.datetime, pd.Timestamp)):
            return None if pd.isna(v) else str(v)
        try:
            if pd.isna(v): return None
        except Exception: pass
        return str(v)
    except Exception:
        return None

def df_payload(df):
    if df is None: return {'columns': [], 'rows': []}
    cols = [str(c) for c in df.columns]
    rows = [{str(c): jsonable(v) for c, v in rec.items()} for rec in df.to_dict('records')]
    return {'columns': cols, 'rows': rows}

def enforce_cols(df, order):
    for c in order:
        if c not in df.columns: df[c] = ""
    return df[order]

# ================= PARSING =================
def get_week_number(data, engine):
    try:
        xls = pd.ExcelFile(io.BytesIO(data), engine=engine)
        for sheet in xls.sheet_names:
            df_head = pd.read_excel(io.BytesIO(data), sheet_name=sheet, nrows=5, header=None, engine=engine)
            for i in range(min(5, len(df_head))):
                for j in range(min(15, len(df_head.columns))):
                    val = df_head.iloc[i, j]
                    if pd.notna(val):
                        dt = pd.to_datetime(val, errors='coerce')
                        if pd.isna(dt): dt = pd.to_datetime(str(val), errors='coerce')
                        if not pd.isna(dt): return f"S{dt.isocalendar().week:02d}"
    except: pass
    return None

def parse_planning(sources, jours):
    all_planning = []
    for data, engine in sources:
        xls = pd.ExcelFile(io.BytesIO(data), engine=engine)
        df = None
        if "Tout (WFO+WFH)" in xls.sheet_names:
            df = pd.read_excel(io.BytesIO(data), sheet_name="Tout (WFO+WFH)", header=None, skiprows=3, engine=engine)
            cols = [3, 4, 5, 6, 7, 10, 11, 12, 13, 15, 16, 17, 19, 20, 21, 23, 24, 25, 27, 28, 29, 31, 32, 33, 35, 36, 37]
            df = df.iloc[:, cols]
        elif "TMM" in xls.sheet_names:
            df_head = pd.read_excel(io.BytesIO(data), sheet_name="TMM", header=None, nrows=10, engine=engine)
            header_row_idx, trans_col_idx = None, 0
            for i in range(len(df_head)):
                row = df_head.iloc[i].astype(str).str.strip().tolist()
                if "Transport" in row:
                    header_row_idx, trans_col_idx = i, row.index("Transport"); break
            if header_row_idx is None: continue
            df = pd.read_excel(io.BytesIO(data), sheet_name="TMM", header=None, skiprows=header_row_idx + 1, engine=engine)
            o = trans_col_idx
            cols = [0+o, 4+o, 2+o, 5+o, 8+o] + [c+o for c in (10,11,12,13,17,18,19,23,24,25,29,30,31,35,36,37,41,42,43,47,48,49)]
            df = df.iloc[:, cols]
        else:
            continue
        new_cols = BASE_COLS + [f'{j}{s}' for j in jours for s in ('_DE', '_A', '_Pause')]
        df.columns = new_cols
        df['WORKDAY ID'] = df['WORKDAY ID'].astype(str).str.replace(" ", "").str.replace(".0", "").str.upper()
        df['Paid ID'] = df['Paid ID'].astype(str).str.replace(" ", "").str.upper()
        df = df[df['WORKDAY ID'].str.contains(r'[A-Z0-9]', na=False)]
        df = df[~df['WORKDAY ID'].isin(['NAN', 'NONE', '*', ''])]
        for j in jours:
            df[f'{j}_Flag'] = df[f'{j}_DE'].apply(lambda x: 1 if is_planned(x) else 0)
        all_planning.append(df)
    if all_planning:
        return pd.concat(all_planning, ignore_index=True).drop_duplicates(subset=['WORKDAY ID'])
    return pd.DataFrame()

def parse_commande(src_bytes, jours):
    raw = pd.read_excel(io.BytesIO(src_bytes), header=None, nrows=8)
    header_row = 0
    for i in range(len(raw)):
        vals = [str(v).strip().upper() for v in raw.iloc[i].tolist()]
        if any("LUNDI" in v for v in vals):
            header_row = i; break
    df = pd.read_excel(io.BytesIO(src_bytes), header=header_row)
    df = df.rename(columns={df.columns[0]: 'Paid ID'})
    day_idx = list(range(2, 9)) if len(df.columns) >= 9 else list(range(1, 8))
    out = df.iloc[:, [0] + day_idx].copy()
    out.columns = ["Paid ID"] + jours
    out["Paid ID"] = out["Paid ID"].apply(clean_id)
    out = out[out["Paid ID"] != ""]
    out = out[~out["Paid ID"].str.contains("EXEMPLE|VOTRE|MATRICULE", na=False)]
    return out

def parse_reference(src_bytes):
    try:
        df = pd.read_excel(io.BytesIO(src_bytes))
        df.columns = ["".join(str(c).upper().split()) for c in df.columns]
    except Exception:
        return None
    wd_col = pd_col = None
    for c in df.columns:
        if 'WORKDAY' in c or 'EMPLOYEEID' in c: wd_col = c
        if 'PAYROLLID' in c or 'PAIDID' in c or 'MATRICULEPAIE' in c: pd_col = c
    if wd_col is None or pd_col is None:
        return {'error': True, 'columns': list(df.columns)}
    df = df[[wd_col, pd_col]].copy()
    for c in (wd_col, pd_col):
        df[c] = df[c].astype(str).str.replace(" ", "").str.replace(".0", "").str.upper()
    df = df.dropna(subset=[wd_col])
    df = df[df[wd_col].str.contains(r'[A-Z0-9]', na=False)]
    df = df[~df[wd_col].isin(['NAN', 'NONE', '*', ''])]
    return df.drop_duplicates(subset=[wd_col]).rename(columns={wd_col: 'WORKDAY ID', pd_col: 'REF_PAID_ID'})

# ================= CONSTRUCTEURS =================
def _apply_filters(pl):
    out = pl.copy()
    for col, key in (('TRANSPORT', 'transport'), ('Projet', 'projet'), ('Statut', 'statut')):
        v = (request.args.get(key) or '').strip()
        if v: out = out[out[col].astype(str) == v]
    q = (request.args.get('q') or '').strip()
    if q:
        ql = q.lower()
        mask = out[BASE_COLS[1:4]].astype(str).apply(lambda r: any(ql in str(v).lower() for v in r), axis=1)
        out = out[mask]
    return out

def build_pivot(pl, taux, prest):
    pivot = pl.pivot_table(index='Projet', values=[f'{j}_Flag' for j in JOURS], aggfunc='sum', fill_value=0)
    pivot = pivot[[f'{j}_Flag' for j in JOURS]]; pivot.columns = JOURS
    pivot.loc['Total Théorique'] = pivot.sum()
    pivot.loc[f'Total Estimé (-{int(taux)}%)'] = (pivot.loc['Total Théorique'] * (1 - taux / 100)).round(0)
    pivot.loc['Prestataires (Hors Planning)'] = prest
    pivot.loc['Total à commander'] = pivot.loc[f'Total Estimé (-{int(taux)}%)'] + pivot.loc['Prestataires (Hors Planning)']
    return enforce_cols(pivot.reset_index(), ['Projet'] + JOURS)

def build_shifts(pl):
    shift_rows = []
    for _, row in pl.iterrows():
        for j in JOURS:
            de = get_time_obj(row[f'{j}_DE'])
            if de:
                shift_rows.append({'Workday ID': row['WORKDAY ID'], 'Nom': row['Nom'], 'Projet': row['Projet'],
                                   'Jour': j, 'Transport': row['TRANSPORT'], 'Shift (Début)': de.strftime('%H:%M')})
    df = pd.DataFrame(shift_rows)
    if df.empty: return None, None
    df = enforce_cols(df, ['Workday ID', 'Nom', 'Projet', 'Jour', 'Transport', 'Shift (Début)'])
    pivot = df.pivot_table(index='Shift (Début)', columns='Jour', values='Nom', aggfunc='count', fill_value=0)
    pivot = pivot.reindex(columns=JOURS, fill_value=0)
    pivot['Total Semaine'] = pivot.sum(axis=1); pivot.loc['Total'] = pivot.sum()
    pivot = enforce_cols(pivot.reset_index(), ['Shift (Début)'] + JOURS + ['Total Semaine'])
    return pivot, df.sort_values(by=['Jour', 'Shift (Début)', 'Nom'])

def build_slots_peaks(pl):
    hours = [f"{h:02d}:00" for h in range(24)]
    slots = pd.DataFrame(0, index=hours, columns=JOURS)
    ph = {}
    for _, row in pl.iterrows():
        projet = str(row['Projet'])
        ph.setdefault(projet, {j: {h: 0 for h in range(24)} for j in JOURS})
        for di, j in enumerate(JOURS):
            de, a = get_time_obj(row[f'{j}_DE']), get_time_obj(row[f'{j}_A'])
            pause = get_pause_start(row[f'{j}_Pause'])
            for off, h in calculate_slots(de, a, pause):
                tgt = JOURS[(di + off) % 7]
                slots.loc[f"{h:02d}:00", tgt] += 1
                ph[projet][tgt][h] += 1
    slots['Total Jour'] = slots.sum(axis=1)
    slots.loc['Total par Créneau'] = slots.sum(axis=0)
    slots = enforce_cols(slots.rename_axis('Créneau').reset_index(), ['Créneau'] + JOURS + ['Total Jour'])
    if ph:
        peaks = pd.DataFrame([{'Projet': p, **{j: (max(d[j].values()) if d[j].values() else 0) for j in JOURS}}
                              for p, d in ph.items()]).set_index('Projet')
        peaks.loc['Pic Global (Tous Projets)'] = peaks[JOURS].sum().to_dict()
        peaks = enforce_cols(peaks.reset_index(), ['Projet'] + JOURS)
    else:
        peaks = pd.DataFrame(columns=['Projet'] + JOURS)
    return slots, peaks

def build_conf(pl, cmd):
    pl = pl.copy(); cmd = cmd.copy()
    pl['Paid ID'] = pl['Paid ID'].apply(clean_id)
    cmd['Paid ID'] = cmd['Paid ID'].apply(clean_id)
    pl = pl[pl['Paid ID'] != '']
    cmd = cmd[cmd['Paid ID'] != '']
    merged = pd.merge(pl, cmd, on='Paid ID', how='outer')
    display_rows = []
    for _, row in merged.iterrows():
        has_planning = not pd.isna(row.get('Nom', np.nan))
        display_row = {'Workday ID': row['WORKDAY ID'] if has_planning else "", 'Paid ID': row['Paid ID'],
                       'Nom': row['Nom'] if has_planning else "", 'Projet': row['Projet'] if has_planning else "",
                       'Statut': row['Statut'] if has_planning else ""}
        for j in JOURS:
            if has_planning:
                planning_str = get_planning_status(row[f'{j}_DE'], row[f'{j}_A'])
            else:
                planning_str = "hors planning" if j in row and not pd.isna(row[j]) and str(row[j]).strip() not in ['*', ''] else ""
            cmd_str = row[j] if j in row and not pd.isna(row[j]) else ""
            if str(cmd_str).strip() in ['*', '']: cmd_str = ""
            display_row[f'{j} - Planning'] = planning_str
            display_row[f'{j} - Commande'] = cmd_str
        display_rows.append(display_row)
    return pd.DataFrame(display_rows)

def build_anomalies(conf):
    anomalies = []
    for _, row in conf.iterrows():
        for j in JOURS:
            plan_val = str(row[f'{j} - Planning']).strip(); cmd_val = str(row[f'{j} - Commande']).strip()
            absence = is_absence_command(cmd_val)
            if plan_val == "Planifié" and (cmd_val == "" or absence):
                anomalies.append({'Paid ID': row['Paid ID'], 'Nom': row['Nom'], 'Projet': row['Projet'], 'Jour': j,
                                  "Type d'anomalie": "Planifié sans commande", 'Commande': cmd_val if cmd_val else "Aucune"})
            elif plan_val != "Planifié" and cmd_val != "" and not absence:
                anomalies.append({'Paid ID': row['Paid ID'], 'Nom': row['Nom'], 'Projet': row['Projet'], 'Jour': j,
                                  "Type d'anomalie": "Non planifié avec commande", 'Commande': cmd_val})
    return pd.DataFrame(anomalies)

def excel_bytes(df, sheet='Data', index=False):
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine='openpyxl') as w:
        df.to_excel(w, index=index, sheet_name=sheet[:31])
    buf.seek(0); return buf

def excel_multi(sheets):
    buf = io.BytesIO()
    with pd.ExcelWriter(buf, engine='openpyxl') as w:
        for name, df in sheets.items():
            df.to_excel(w, index=False, sheet_name=name[:31])
    buf.seek(0); return buf

def dl(buf, filename):
    return send_file(buf, download_name=filename,
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

# ================= GESTIONNAIRE D'ERREURS =================
@app.errorhandler(Exception)
def handle_exception(e):
    app.logger.exception("Erreur serveur LogiPlan")
    if isinstance(e, HTTPException):
        return jsonify({'error': e.description}), e.code
    return jsonify({'error': f"Erreur serveur : {type(e).__name__} — {e}"}), 500

# ================= ROUTES =================
@app.get('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.get('/api/state')
def api_state():
    weeks = sorted(STATE['plannings'].keys())
    cur = STATE.get('current_week')
    if cur not in weeks and weeks:
        cur = weeks[-1]; STATE['current_week'] = cur; save_state()
    _, pl, cmd = current_data()
    return {'weeks': weeks, 'current_week': cur,
            'has_planning': pl is not None, 'has_commande': cmd is not None,
            'has_reference': isinstance(STATE.get('reference'), pd.DataFrame)}

@app.post('/api/import')
def api_import():
    planning_files = request.files.getlist('planning')
    if not planning_files:
        return jsonify({'error': "Aucun fichier planning fourni"}), 400
    sources = [(f.read(), 'pyxlsb' if f.filename.endswith('.xlsb') else None) for f in planning_files]
    week = (request.form.get('week') or '').strip()
    if not week:
        for data, engine in sources:
            wk = get_week_number(data, engine)
            if wk: week = wk; break
        if not week: week = f"S{datetime.datetime.now().isocalendar().week:02d}"
    planning_df = parse_planning(sources, JOURS)
    if not planning_valide(planning_df):
        return jsonify({'error': "Aucun planning exploitable (feuille « Tout (WFO+WFH) » ou « TMM » attendue)."}), 400
    warnings = []
    prev_calc = STATE['calculs'].get(week) if isinstance(STATE['calculs'].get(week), dict) else {}
    STATE['plannings'][week] = planning_df
    STATE['calculs'][week] = {}
    if isinstance(prev_calc.get('presta'), dict): STATE['calculs'][week]['presta'] = prev_calc['presta']
    if isinstance(prev_calc.get('conf'), pd.DataFrame): STATE['calculs'][week]['conf'] = prev_calc['conf']
    cmd_f = request.files.get('commande')
    if cmd_f:
        try:
            STATE['commandes'][week] = parse_commande(cmd_f.read(), JOURS)
        except Exception as e:
            STATE['commandes'][week] = None; warnings.append(f"Commandes illisible : {e}")
    else:
        STATE['commandes'].setdefault(week, None)
    ref_f = request.files.get('reference')
    if ref_f:
        ref = parse_reference(ref_f.read())
        if isinstance(ref, dict) and ref.get('error'):
            warnings.append("Liste Actif : colonnes Employee ID / Previous Payroll ID introuvables.")
        elif ref is not None:
            STATE['reference'] = ref
    STATE['current_week'] = week
    save_state()
    cmd = STATE['commandes'].get(week)
    return {'ok': True, 'week': week, 'n_planifiees': len(planning_df),
            'n_commandes': (len(cmd) if cmd is not None else 0), 'warnings': warnings}

@app.post('/api/select_week')
def api_select_week():
    w = (request.json or {}).get('week')
    if w in STATE['plannings']:
        STATE['current_week'] = w; save_state(); return {'ok': True}
    return jsonify({'error': 'Semaine inconnue'}), 400

@app.post('/api/delete_week')
def api_delete_week():
    w = (request.json or {}).get('week')
    STATE['plannings'].pop(w, None); STATE['commandes'].pop(w, None); STATE['calculs'].pop(w, None)
    STATE['current_week'] = next(iter(sorted(STATE['plannings'])), None)
    save_state(); return {'ok': True}

@app.get('/api/page1')
def api_page1():
    week, pl, _ = current_data()
    if pl is None:
        return {'columns': [], 'rows': [], 'options': {}, 'week': week, 'total': 0, 'shown': 0}
    cols = BASE_COLS + [f'{j}{s}' for j in JOURS for s in ('_DE', '_A', '_Pause', '_Flag')]
    cols = [c for c in cols if c in pl.columns]
    disp = pl[cols].copy()
    for j in JOURS:
        for suf in ('_DE', '_A', '_Pause'):
            disp[f'{j}{suf}'] = disp[f'{j}{suf}'].apply(format_time_display)
        disp[f'{j}_Flag'] = pd.to_numeric(disp[f'{j}_Flag'], errors='coerce').fillna(0).astype(int)
    filtered = _apply_filters(disp)
    p = df_payload(filtered)
    p['options'] = {c: sorted(pl[c].astype(str).unique().tolist()) for c in ('TRANSPORT', 'Projet', 'Statut')}
    p['week'] = week; p['total'] = len(disp); p['shown'] = len(filtered)
    return p

@app.get('/api/export_page1')
def api_export_page1():
    _, pl, _ = current_data()
    if pl is None: return jsonify({'error': 'Aucun planning'}), 400
    cols = BASE_COLS + [f'{j}{s}' for j in JOURS for s in ('_DE', '_A', '_Pause', '_Flag')]
    disp = pl[[c for c in cols if c in pl.columns]].copy()
    for j in JOURS:
        for suf in ('_DE', '_A', '_Pause'):
            disp[f'{j}{suf}'] = disp[f'{j}{suf}'].apply(format_time_display)
    return dl(excel_bytes(_apply_filters(disp)), 'planning_regroupé.xlsx')

def _store_presta(week, prest_list):
    if week:
        STATE['calculs'].setdefault(week, {})['presta'] = {j: _to_int(n) for j, n in zip(JOURS, prest_list)}
        save_state()

@app.get('/api/page2')
def api_page2():
    week, pl, _ = current_data()
    if pl is None: return {'rows': [], 'metrics': {}}
    pl = _apply_filters(pl)
    if pl.empty: return {'rows': [], 'metrics': {j: 0 for j in JOURS}}
    taux = _to_float(request.args.get('taux'), 0)
    prest = [_to_int(request.args.get(f'prest_{j}')) for j in JOURS]
    _store_presta(week, prest)   # stocké pour la page Commandes par menu
    pivot = build_pivot(pl, taux, prest)
    p = df_payload(pivot)
    tot = pivot[pivot['Projet'] == 'Total à commander']
    p['metrics'] = {j: (int(round(float(tot.iloc[0][j]))) if not tot.empty else 0) for j in JOURS}
    return p

@app.get('/api/export_page2')
def api_export_page2():
    week, pl, _ = current_data()
    if pl is None: return jsonify({'error': 'Aucun planning'}), 400
    pl = _apply_filters(pl)
    taux = _to_float(request.args.get('taux'), 0)
    prest = [_to_int(request.args.get(f'prest_{j}')) for j in JOURS]
    _store_presta(week, prest)   # stocké aussi à l'export
    return dl(excel_bytes(build_pivot(pl, taux, prest)), 'effectifs.xlsx')

@app.get('/api/page3')
def api_page3():
    _, pl, _ = current_data()
    empty = {'pivot': {'columns': [], 'rows': []}, 'detail': {'columns': [], 'rows': []}}
    if pl is None: return empty
    pivot, detail = build_shifts(_apply_filters(pl))
    if pivot is None: return empty
    return {'pivot': df_payload(pivot), 'detail': df_payload(detail)}

@app.get('/api/export_page3')
def api_export_page3():
    _, pl, _ = current_data()
    if pl is None: return jsonify({'error': 'Aucun planning'}), 400
    pivot, detail = build_shifts(_apply_filters(pl))
    if pivot is None: return jsonify({'error': 'Aucun shift trouvé'}), 400
    return dl(excel_multi({'Resume': pivot, 'Detail': detail}), 'shifts.xlsx')

@app.get('/api/page4')
def api_page4():
    _, pl, _ = current_data()
    if pl is None: return {'peaks': {'columns': [], 'rows': []}, 'slots': {'columns': [], 'rows': []}}
    slots, peaks = build_slots_peaks(_apply_filters(pl))
    return {'peaks': df_payload(peaks), 'slots': df_payload(slots)}

@app.get('/api/export_page4')
def api_export_page4():
    _, pl, _ = current_data()
    if pl is None: return jsonify({'error': 'Aucun planning'}), 400
    slots, peaks = build_slots_peaks(_apply_filters(pl))
    return dl(excel_multi({'Pics': peaks, 'Creneaux': slots}), 'creneaux_pics.xlsx')

@app.post('/api/page5')
def api_page5():
    week, pl, cmd = current_data()
    if pl is None: return jsonify({'error': "Chargez d'abord un planning (onglet 1)."}), 400
    if cmd is None: return jsonify({'error': "Importez le fichier Commandes dans la barre latérale."}), 400
    conf = build_conf(pl, cmd)
    STATE['calculs'].setdefault(week, {})['conf'] = conf
    save_state()
    return df_payload(conf)

@app.post('/api/export_conf')
def api_export_conf():
    wk = STATE.get('current_week')
    conf = (STATE['calculs'].get(wk) or {}).get('conf') if isinstance(STATE['calculs'].get(wk), dict) else None
    if conf is None: return jsonify({'error': "Générez d'abord la confrontation."}), 400
    return dl(excel_bytes(conf), 'confrontation.xlsx')

@app.get('/api/prefixes')
def api_prefixes():
    """Correspondance automatique en lecture seule : W*/ST -> PROD, reste -> HORS PROD."""
    try:
        week, pl, cmd = current_data()
        ids = safe_paid_ids(cmd) | safe_paid_ids(pl)
        prefixes = sorted({alpha_prefix(i) for i in ids if alpha_prefix(i)})
        return {'entities': ENTITES,
                'prefixes': [{'prefix': p, 'entity': entity_for(p + 'X')} for p in prefixes]}
    except Exception as e:
        app.logger.exception("api_prefixes")
        return jsonify({'error': f"Correspondance impossible : {e}"}), 400

def _recap_compute(body):
    week, pl, cmd = current_data()
    raw_taux = body.get('taux') or {}
    taux_by_day = {j: _to_float(raw_taux.get(j), 0) for j in JOURS}
    presta_effectifs = get_presta_effectifs(week)
    recap, day_totals = compute_recap_menus(pl, cmd, JOURS, taux_by_day, presta_effectifs)
    return week, pl, cmd, recap, day_totals, presta_effectifs

@app.post('/api/recap')
def api_recap():
    try:
        body = request.get_json(force=True, silent=True) or {}
        week, pl, cmd, recap, day_totals, presta_effectifs = _recap_compute(body)
        if cmd is None:
            return jsonify({'error': "Aucune commande disponible : importez le fichier Commandes dans la barre latérale."}), 400
        dates = derive_week_dates(week)
        mois_fr = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
                   "septembre", "octobre", "novembre", "décembre"]
        days, day_order, summary = {}, [], []
        for j in JOURS:
            d = dates.get(j)
            date_txt = f"{d.day:02d} {mois_fr[d.month-1]} {d.year}" if d else ""
            a_cmd = day_totals[j]
            entities = []
            for ent in ENTITES_MAIN:
                blk = recap[(j, ent)]
                rows = [{'Choix': r['Choix'], 'Nombres': _to_int(r['Nombres']),
                         'Pourcentage': round(float(r['Pourcentage']), 1),
                         'À commander': _to_int(r['À commander'])}
                        for r in blk['df'].to_dict('records')]
                entities.append({'entity': ent, 'color': ENTITY_COLORS[ent],
                                 'planned_n': blk['planned_n'], 'sans_choix': blk['sans_choix'],
                                 'abs_prevues': blk['abs_prevues'], 'rows': rows})
            days[j] = {'date': date_txt, 'a_commander': a_cmd,
                       'ent_line': " • ".join(f"{e} : {recap[(j, e)]['total_ac']}" for e in ENTITES_MAIN),
                       'entities': entities}
            day_order.append(j)
            row = {'Jour': j}; row.update({e: recap[(j, e)]['total_ac'] for e in ENTITES_MAIN})
            row.update({'À commander': a_cmd}); summary.append(row)
        total = {'Jour': 'TOTAL SEMAINE'}
        for k in ENTITES_MAIN + ['À commander']:
            total[k] = sum(r[k] for r in summary)
        summary.append(total)
        return {'week': week, 'day_order': day_order, 'days': days, 'summary_rows': summary,
                'has_planning': pl is not None, 'has_presta': presta_effectifs is not None}
    except Exception as e:
        app.logger.exception("api_recap")
        return jsonify({'error': f"Erreur de calcul : {type(e).__name__} — {e}"}), 400

@app.post('/api/export_recap')
def api_export_recap():
    try:
        body = request.get_json(force=True, silent=True) or {}
        week, pl, cmd, recap, _, _ = _recap_compute(body)
        if cmd is None: return jsonify({'error': "Aucune commande disponible."}), 400
        export_rows = [{'Jour': j, 'Entité': ent, 'Choix': r['Choix'], 'Nombres': r['Nombres'],
                        'Pourcentage (%)': round(float(r['Pourcentage']), 1), 'À commander': r['À commander']}
                       for j in JOURS for ent in ENTITES for _, r in recap[(j, ent)]['df'].iterrows()]
        return dl(excel_bytes(pd.DataFrame(export_rows), 'Recap'), 'recap_commandes_menus.xlsx')
    except Exception as e:
        app.logger.exception("api_export_recap")
        return jsonify({'error': f"Erreur d'export : {e}"}), 400

@app.post('/api/page7')
def api_page7():
    wk = STATE.get('current_week')
    conf = (STATE['calculs'].get(wk) or {}).get('conf') if isinstance(STATE['calculs'].get(wk), dict) else None
    if conf is None: return jsonify({'error': "Générez d'abord la confrontation (onglet 5)."}), 400
    return df_payload(build_anomalies(conf))

@app.post('/api/export_anom')
def api_export_anom():
    wk = STATE.get('current_week')
    conf = (STATE['calculs'].get(wk) or {}).get('conf') if isinstance(STATE['calculs'].get(wk), dict) else None
    if conf is None: return jsonify({'error': "Générez d'abord la confrontation."}), 400
    return dl(excel_bytes(build_anomalies(conf)), 'anomalies_commande.xlsx')

@app.get('/api/matricules')
def api_matricules():
    week, pl, _ = current_data()
    if pl is None: return jsonify({'error': "Chargez d'abord un planning."}), 400
    ref = STATE.get('reference')
    if not isinstance(ref, pd.DataFrame):
        return jsonify({'error': "Importez le fichier « Liste Actif » dans la barre latérale."}), 400
    check = pd.merge(pl[['WORKDAY ID', 'Paid ID', 'Nom', 'Projet']], ref[['WORKDAY ID', 'REF_PAID_ID']],
                     on='WORKDAY ID', how='left')
    mismatch = check[(check['REF_PAID_ID'].notna()) & (check['Paid ID'].astype(str) != check['REF_PAID_ID'].astype(str))]
    notfound = check[check['REF_PAID_ID'].isna()]
    return {'mismatch': df_payload(mismatch), 'notfound': df_payload(notfound)}

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))
