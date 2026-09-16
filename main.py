import os, io, re, pickle, datetime, unicodedata
import pandas as pd
import numpy as np
from flask import Flask, request, jsonify, send_file, send_from_directory

app = Flask(__name__, static_folder='static', static_url_path='/static')

JOURS = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche']
COLONNES_OBLIGATOIRES = ['TRANSPORT', 'WORKDAY ID', 'Paid ID', 'Nom', 'Projet', 'Statut']
ENTITES = ["PRESTA", "SUPPORT + SAI", "PROD / PLANIFIÉ PROD", "AUTRE / IGNORÉ"]
ENTITES_MAIN = ENTITES[:3]
ENTITY_COLORS = {"PRESTA": "#4472C4", "SUPPORT + SAI": "#1F9AA8",
                 "PROD / PLANIFIÉ PROD": "#548235", "AUTRE / IGNORÉ": "#7F7F7F"}
DATA_FILE = 'logiplan_state.pkl'

# ================= ETAT (persisté dans un fichier) =================
def load_state():
    if os.path.exists(DATA_FILE):
        try:
            with open(DATA_FILE, 'rb') as f:
                s = pickle.load(f)
            s.setdefault('plannings', {}); s.setdefault('commandes', {})
            s.setdefault('reference', None); s.setdefault('calculs', {}); s.setdefault('current_week', None)
            return s
        except Exception:
            pass
    return {'plannings': {}, 'commandes': {}, 'reference': None, 'calculs': {}, 'current_week': None}

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

# ================= FONCTIONS UTILITAIRES (reprises de LogiPlan) =================
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

# ================= HELPERS PAGE 6 (feuille « Recap ») =================
VALEURS_NON_MENU = {"LUNDI", "MARDI", "MERCREDI", "JEUDI", "VENDREDI", "SAMEDI", "DIMANCHE",
                    "SHIFT", "WKD", "MENU", "CHOIX", "NOMS", "NOM", "PRENOMS", "PRÉNOMS", "PRENOM",
                    "PRÉNOM", "PROJETS", "PROJET", "DEPARTEMENT", "DÉPARTEMENT", "DEPT", "CHECK",
                    "UNIQUE", "CODE", "MATRICULE", "VOTRE MATRICULE", "", "*", "NAN", "NONE", "0"}

def strip_accents(s):
    return "".join(c for c in unicodedata.normalize("NFD", str(s)) if unicodedata.category(c) != "Mn")

def get_prefix(mat):
    m = str(mat).strip().upper()
    return m[:2] if len(m) >= 2 else m

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

def normalize_entity(raw):
    if raw is None or pd.isna(raw): return None
    s = strip_accents(str(raw)).upper().strip()
    if not s: return None
    if "PRESTA" in s: return "PRESTA"
    if "SUPPORT" in s or "SAI" in s: return "SUPPORT + SAI"
    if "PROD" in s: return "PROD / PLANIFIÉ PROD"
    return "AUTRE / IGNORÉ"

def build_entity_seed(cmd_df):
    """Table Préfixe -> Entité proposée depuis la colonne « Departement » du fichier commande."""
    seed = {}
    try:
        if cmd_df is not None and not cmd_df.empty:
            dep_col = next((c for c in cmd_df.columns
                            if "DEPARTEMENT" in strip_accents(str(c)).upper()
                            or strip_accents(str(c)).upper() in ("DEPT", "ENTITE", "SERVICE")), None)
            if dep_col:
                tmp = cmd_df[["Paid ID", dep_col]].dropna(subset=[dep_col]).copy()
                tmp["prefix"] = tmp["Paid ID"].astype(str).apply(get_prefix)
                tmp["ent"] = tmp[dep_col].apply(normalize_entity)
                tmp = tmp[tmp["ent"].notna()]
                if not tmp.empty:
                    seed = tmp.groupby("prefix")["ent"].agg(lambda x: x.mode().iloc[0]).to_dict()
    except Exception:
        pass
    seed["SA"] = "SUPPORT + SAI"   # SI(GAUCHE(matricule;2)="SA";"SUPPORT";...)
    return seed

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

def compute_recap_menus(planning_df, cmd_df, mapping, jours, taux_by_entity, taux_default):
    """Logique Recap : entité par préfixe matricule ; SANS CHOIX = planifiés sans commande
    + « Je ne serai pas présent » ; A preparer = Nombres × (1 − taux)."""
    melted = pd.DataFrame()
    if cmd_df is not None and not cmd_df.empty:
        day_cols = [j for j in jours if j in cmd_df.columns]
        melted = cmd_df.melt(id_vars=["Paid ID"], value_vars=day_cols, var_name="Jour", value_name="Brut")
        melted = melted[melted["Brut"].notna()].copy()
        melted["Brut"] = melted["Brut"].astype(str).str.strip()
        melted = melted[melted["Brut"] != ""]
        melted["Entite"] = melted["Paid ID"].astype(str).apply(lambda x: mapping.get(get_prefix(x), "PROD / PLANIFIÉ PROD"))
        melted["Absence"] = melted["Brut"].apply(is_absence_label)
        melted["Menu"] = melted["Brut"].apply(clean_menu_label)

    planned_ids = {(j, e): set() for j in jours for e in ENTITES}
    if planning_df is not None and not planning_df.empty:
        p = planning_df.copy()
        p["Paid ID"] = p["Paid ID"].astype(str)
        p = p[~p["Paid ID"].isin(["", "NAN", "NONE", "*"])]
        p["Entite"] = p["Paid ID"].apply(lambda x: mapping.get(get_prefix(x), "PROD / PLANIFIÉ PROD"))
        for j in jours:
            if f"{j}_Flag" in p.columns:
                for ent, g in p[p[f"{j}_Flag"] == 1].groupby("Entite"):
                    planned_ids[(j, ent)] |= set(g["Paid ID"])

    menus_cnt, abs_cnt, ordered, day_menu_totals = {}, {}, {}, {}
    if not melted.empty:
        for (j, ent, mn), g in melted[melted["Menu"].notna()].groupby(["Jour", "Entite", "Menu"]):
            menus_cnt[(j, ent, mn)] = len(g)
            day_menu_totals.setdefault(j, {})
            day_menu_totals[j][mn] = day_menu_totals[j].get(mn, 0) + len(g)
        for (j, ent), g in melted[melted["Absence"]].groupby(["Jour", "Entite"]):
            abs_cnt[(j, ent)] = len(g)
        valid_resp = melted[melted["Menu"].notna() | melted["Absence"]]
        for (j, ent), g in valid_resp.groupby(["Jour", "Entite"]):
            ordered[(j, ent)] = set(g["Paid ID"].astype(str))

    recap, day_totals = {}, {}
    for j in jours:
        menu_list = [m for m, _ in sorted(day_menu_totals.get(j, {}).items(), key=lambda kv: (-kv[1], kv[0]))]
        for ent in ENTITES:
            facteur = 1.0 - (taux_by_entity.get(ent, taux_default) / 100.0)
            pids, ords = planned_ids.get((j, ent), set()), ordered.get((j, ent), set())
            abs_n = abs_cnt.get((j, ent), 0)
            sans_choix = len(pids - ords) + abs_n
            total_n = sum(menus_cnt.get((j, ent, m), 0) for m in menu_list) + sans_choix
            rows = []
            for m in menu_list:
                n = menus_cnt.get((j, ent, m), 0)
                rows.append({"Choix": m, "Nombres": n,
                             "Pourcentage": (n / total_n * 100) if total_n else 0.0,
                             "A preparer": int(n * facteur + 0.5)})
            if abs_n:
                rows.append({"Choix": "dont « Je ne serai pas présent » (inclus dans SANS CHOIX)",
                             "Nombres": abs_n,
                             "Pourcentage": (abs_n / total_n * 100) if total_n else 0.0, "A preparer": ""})
            rows.append({"Choix": "SANS CHOIX", "Nombres": sans_choix,
                         "Pourcentage": (sans_choix / total_n * 100) if total_n else 0.0,
                         "A preparer": int(sans_choix * facteur + 0.5)})
            total_prep = sum(r["A preparer"] for r in rows if isinstance(r["A preparer"], (int, np.integer)))
            rows.append({"Choix": "TOTAL", "Nombres": total_n,
                         "Pourcentage": 100.0 if total_n else 0.0, "A preparer": total_prep})
            recap[(j, ent)] = {"df": pd.DataFrame(rows), "planned_n": len(pids), "reponses": len(ords),
                               "abs_n": abs_n, "sans_choix": sans_choix, "total_n": total_n,
                               "total_prep": total_prep}
        day_totals[j] = sum(recap[(j, e)]["total_prep"] for e in ENTITES_MAIN)
    return recap, day_totals

# ================= PARSING (repris de LogiPlan, adaptés à des bytes) =================
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
        new_cols = ['TRANSPORT', 'WORKDAY ID', 'Paid ID', 'Nom', 'Projet', 'Statut',
                    'Lundi_DE', 'Lundi_A', 'Lundi_Pause', 'Mardi_DE', 'Mardi_A', 'Mardi_Pause',
                    'Mercredi_DE', 'Mercredi_A', 'Mercredi_Pause', 'Jeudi_DE', 'Jeudi_A', 'Jeudi_Pause',
                    'Vendredi_DE', 'Vendredi_A', 'Vendredi_Pause', 'Samedi_DE', 'Samedi_A', 'Samedi_Pause',
                    'Dimanche_DE', 'Dimanche_A', 'Dimanche_Pause']
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
    extras, used = [], set()
    for idx, c in enumerate(df.columns):
        if idx == 0 or idx in day_idx: continue
        cu = strip_accents(str(c)).upper().strip()
        target = None
        if cu in ("NOMS", "NOM", "PRENOMS", "PRÉNOMS", "PRENOM", "PRÉNOM"): target = "CMD_Nom"
        elif cu in ("PROJETS", "PROJET"): target = "CMD_Projet"
        elif "DEPARTEMENT" in cu or cu in ("DEPT", "ENTITE", "ENTITÉ", "SERVICE"): target = "CMD_Departement"
        if target and target not in used:
            extras.append((idx, target)); used.add(target)
    out = df.iloc[:, [0] + day_idx + [i for i, _ in extras]].copy()
    out.columns = ["Paid ID"] + jours + [t for _, t in extras]
    out["Paid ID"] = out["Paid ID"].astype(str).str.replace(" ", "").str.upper()
    out = out[out["Paid ID"].str.contains(r'[A-Z]-?\d', na=False)]
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

# ================= SÉRIALISATION JSON =================
def jsonable(v):
    if v is None: return None
    if isinstance(v, datetime.time): return v.strftime('%H:%M')
    if isinstance(v, (datetime.datetime, pd.Timestamp)): return str(v)
    if isinstance(v, np.integer): return int(v)
    if isinstance(v, (np.floating, float)):
        try: return None if np.isnan(v) else float(v)
        except Exception: return None
    if v is pd.NaT: return None
    return v

def df_payload(df):
    rows = [{c: jsonable(v) for c, v in rec.items()} for rec in df.to_dict('records')]
    return {'columns': list(df.columns), 'rows': rows}

def current_data():
    week = STATE.get('current_week')
    pl = STATE['plannings'].get(week)
    return week, (pl if planning_valide(pl) else None), STATE['commandes'].get(week)

# ================= ROUTES =================
@app.get('/')
def index():
    return send_from_directory(app.static_folder, 'index.html')

@app.get('/api/state')
def api_state():
    weeks = sorted(STATE['plannings'].keys())
    cur = STATE.get('current_week')
    if cur not in weeks and weeks: cur = weeks[-1]; STATE['current_week'] = cur; save_state()
    return {'weeks': weeks, 'current_week': cur,
            'has_commande': bool(STATE['commandes'].get(cur) is not None),
            'has_reference': STATE.get('reference') is not None}

@app.post('/api/import')
def api_import():
    planning_files = request.files.getlist('planning')
    if not planning_files:
        return jsonify({'error': "Aucun fichier planning fourni"}), 400
    sources = []
    for f in planning_files:
        sources.append((f.read(), 'pyxlsb' if f.filename.endswith('.xlsb') else None))
    week = (request.form.get('week') or '').strip()
    if not week:
        for data, engine in sources:
            wk = get_week_number(data, engine)
            if wk: week = wk; break
        if not week: week = f"S{datetime.datetime.now().isocalendar().week:02d}"
    planning_df = parse_planning(sources, JOURS)
    if not planning_valide(planning_df):
        return jsonify({'error': "Aucun planning exploitable (feuille « Tout (WFO+WFH) » ou « TMM » attendue). Rien n'a été enregistré."}), 400
    warnings = []
    STATE['plannings'][week] = planning_df
    cmd_f = request.files.get('commande')
    if cmd_f:
        try: STATE['commandes'][week] = parse_commande(cmd_f.read(), JOURS)
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
    STATE['calculs'].setdefault(week, {})
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
    if pl is None: return {'columns': [], 'rows': [], 'options': {}, 'week': week}
    disp = pl.copy()
    for j in JOURS:
        for suf in ['_DE', '_A', '_Pause']:
            c = f'{j}{suf}'
            if c in disp.columns: disp[c] = disp[c].apply(format_time_display)
    p = df_payload(disp)
    p['options'] = {c: sorted(disp[c].astype(str).unique().tolist()) for c in ['TRANSPORT', 'Projet', 'Statut']}
    p['week'] = week
    return p

@app.get('/api/export_page1')
def api_export_page1():
    _, pl, _ = current_data()
    if pl is None: return jsonify({'error': 'Aucun planning'}), 400
    buf = io.BytesIO()
    pl.to_excel(buf, index=False, sheet_name='Planning')
    buf.seek(0)
    return send_file(buf, download_name='planning_regroupé.xlsx',
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

def _filtered_planning():
    _, pl, _ = current_data()
    if pl is None: return None
    out = pl.copy()
    for col, key in [('TRANSPORT', 'transport'), ('Projet', 'projet'), ('Statut', 'statut')]:
        v = (request.args.get(key) or '').strip()
        if v: out = out[out[col].astype(str) == v]
    return out

@app.get('/api/page2')
def api_page2():
    pl = _filtered_planning()
    if pl is None: return {'columns': [], 'rows': [], 'metrics': {}}
    taux = float(request.args.get('taux', 0) or 0)
    pivot = pl.pivot_table(index='Projet', values=[f'{j}_Flag' for j in JOURS], aggfunc='sum', fill_value=0)
    pivot = pivot[[f'{j}_Flag' for j in JOURS]]; pivot.columns = JOURS
    pivot.loc['Total Théorique'] = pivot.sum()
    pivot.loc[f'Total Estimé (-{taux:.0f}%)'] = (pivot.loc['Total Théorique'] * (1 - taux / 100)).round(0)
    prest = [int(float(request.args.get(f'prest_{j}', 0) or 0)) for j in JOURS]
    pivot.loc['Prestataires (Hors Planning)'] = prest
    pivot.loc['Total à commander'] = pivot.loc[f'Total Estimé (-{taux:.0f}%)'] + pivot.loc['Prestataires (Hors Planning)']
    p = df_payload(pivot.reset_index())
    p['metrics'] = {j: int(pivot.loc['Total à commander', j]) for j in JOURS}
    return p

@app.get('/api/page3')
def api_page3():
    pl = _filtered_planning()
    if pl is None: return {'pivot': {'columns': [], 'rows': []}, 'detail': {'columns': [], 'rows': []}}
    shift_rows = []
    for _, row in pl.iterrows():
        for j in JOURS:
            de = get_time_obj(row[f'{j}_DE'])
            if de:
                shift_rows.append({'Workday ID': row['WORKDAY ID'], 'Nom': row['Nom'], 'Projet': row['Projet'],
                                   'Transport': row['TRANSPORT'], 'Jour': j, 'Shift (Début)': de.strftime('%H:%M')})
    df_shifts = pd.DataFrame(shift_rows)
    if df_shifts.empty:
        return {'pivot': {'columns': [], 'rows': []}, 'detail': {'columns': [], 'rows': []}}
    pivot = df_shifts.pivot_table(index='Shift (Début)', columns='Jour', values='Nom', aggfunc='count', fill_value=0)
    pivot = pivot.reindex(columns=JOURS, fill_value=0)
    pivot['Total Semaine'] = pivot.sum(axis=1); pivot.loc['Total'] = pivot.sum()
    return {'pivot': df_payload(pivot.reset_index()),
            'detail': df_payload(df_shifts.sort_values(by=['Jour', 'Shift (Début)', 'Nom']))}

@app.get('/api/page4')
def api_page4():
    pl = _filtered_planning()
    if pl is None: return {'peaks': {'columns': [], 'rows': []}, 'slots': {'columns': [], 'rows': []}}
    hours = [f"{h:02d}:00" for h in range(24)]
    pivot_slots = pd.DataFrame(0, index=hours, columns=JOURS)
    project_hourly = {}
    for _, row in pl.iterrows():
        projet = row['Projet']
        project_hourly.setdefault(projet, {j: {h: 0 for h in range(24)} for j in JOURS})
        for day_idx, j in enumerate(JOURS):
            de, a = get_time_obj(row[f'{j}_DE']), get_time_obj(row[f'{j}_A'])
            pause = get_pause_start(row[f'{j}_Pause'])
            for offset, hour in calculate_slots(de, a, pause):
                target = JOURS[(day_idx + offset) % 7]
                pivot_slots.loc[f"{hour:02d}:00", target] += 1
                project_hourly[projet][target][hour] += 1
    pivot_slots['Total Jour'] = pivot_slots.sum(axis=1)
    pivot_slots.loc['Total par Créneau'] = pivot_slots.sum(axis=0)
    peak_data = [{'Projet': proj, **{j: (max(d[j].values()) if d[j].values() else 0) for j in JOURS}}
                 for proj, d in project_hourly.items()]
    df_peaks = pd.DataFrame(peak_data).set_index('Projet')
    df_peaks.loc['Pic Global (Tous Projets)'] = df_peaks[JOURS].sum().to_dict()
    return {'peaks': df_payload(df_peaks.reset_index()), 'slots': df_payload(pivot_slots.reset_index())}

@app.post('/api/page5')
def api_page5():
    week, pl, cmd = current_data()
    if pl is None: return jsonify({'error': "Chargez d'abord un planning (Page 1)."}), 400
    if cmd is None: return jsonify({'error': "Importez le fichier Commandes dans la barre latérale."}), 400
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
    conf_df = pd.DataFrame(display_rows)
    STATE['calculs'].setdefault(week, {})['conf'] = conf_df
    save_state()
    return df_payload(conf_df)

@app.post('/api/page7')
def api_page7():
    week = STATE.get('current_week')
    conf = STATE['calculs'].get(week, {}).get('conf')
    if conf is None: return jsonify({'error': "Générez d'abord la confrontation (onglet 5)."}), 400
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
    return df_payload(pd.DataFrame(anomalies))

@app.get('/api/prefixes')
def api_prefixes():
    week, pl, cmd = current_data()
    ids = set()
    if cmd is not None and not cmd.empty: ids |= set(cmd['Paid ID'].astype(str))
    if pl is not None: ids |= set(pl['Paid ID'].astype(str))
    prefixes = sorted({get_prefix(i) for i in ids if i and i.strip() and i.upper() not in ('NAN', 'NONE')})
    seed = build_entity_seed(cmd if cmd is not None else pd.DataFrame())
    saved = STATE['calculs'].get(week, {}).get('mapping', {})
    return {'entities': ENTITES,
            'prefixes': [{'prefix': p, 'current': saved.get(p) or seed.get(p) or 'PROD / PLANIFIÉ PROD'}
                         for p in prefixes]}

def _recap_compute(mapping, taux, presta):
    week, pl, cmd = current_data()
    t = {e: float(taux.get(e, 5)) for e in ENTITES_MAIN}
    recap, day_totals = compute_recap_menus(pl, cmd, mapping or {}, JOURS, t, t.get('PROD / PLANIFIÉ PROD', 5))
    return week, pl, recap, day_totals

@app.post('/api/recap')
def api_recap():
    body = request.get_json(force=True)
    mapping = body.get('mapping') or {}; taux = body.get('taux') or {}; presta = body.get('presta_prevus') or {}
    week, pl, recap, day_totals = _recap_compute(mapping, taux, presta)
    if STATE.get('current_week'):
        STATE['calculs'].setdefault(week, {})['mapping'] = mapping
        save_state()
    dates = derive_week_dates(week)
    mois_fr = ["janvier", "février", "mars", "avril", "mai", "juin", "juillet", "août",
               "septembre", "octobre", "novembre", "décembre"]
    days, day_order, summary = {}, [], []
    for j in JOURS:
        d = dates.get(j)
        date_txt = f"{d.day:02d} {mois_fr[d.month-1]} {d.year}" if d else ""
        prest_n = int(presta.get(j, 0) or 0)
        a_cmd = day_totals[j] + prest_n
        entities = []
        for ent in ENTITES_MAIN:
            blk = recap[(j, ent)]
            rows = [{'Choix': r['Choix'], 'Nombres': r['Nombres'],
                     'Pourcentage': round(float(r['Pourcentage']), 1),
                     'A preparer': (r['A preparer'] if r['A preparer'] != '' else None)}
                    for r in blk['df'].to_dict('records')]
            entities.append({'entity': ent, 'color': ENTITY_COLORS[ent], 'planned_n': blk['planned_n'],
                             'reponses': blk['reponses'], 'abs_n': blk['abs_n'],
                             'sans_choix': blk['sans_choix'], 'rows': rows})
        blk_a = recap[(j, 'AUTRE / IGNORÉ')]
        warn = (f"{blk_a['total_n']} commande(s) / {blk_a['planned_n']} planifié(s) avec un préfixe non classé "
                f"(onglet 6, table de correspondance).") if (blk_a['total_n'] > 0 or blk_a['planned_n'] > 0) else None
        days[j] = {'date': date_txt, 'a_commander': a_cmd, 'presta': prest_n,
                   'ent_line': " • ".join(f"{e} : {recap[(j, e)]['total_prep']}" for e in ENTITES_MAIN),
                   'entities': entities, 'warn': warn}
        day_order.append(j)
        row = {'Jour': j}; row.update({e: recap[(j, e)]['total_prep'] for e in ENTITES_MAIN})
        row.update({'Presta. prévus': prest_n, 'À commander': a_cmd}); summary.append(row)
    total = {'Jour': 'TOTAL SEMAINE'}
    for k in ENTITES_MAIN + ['Presta. prévus', 'À commander']:
        total[k] = sum(r[k] for r in summary)
    summary.append(total)
    return {'week': week, 'day_order': day_order, 'days': days, 'summary_rows': summary,
            'has_planning': pl is not None}

@app.post('/api/export_recap')
def api_export_recap():
    body = request.get_json(force=True)
    mapping = body.get('mapping') or {}; taux = body.get('taux') or {}; presta = body.get('presta_prevus') or {}
    week, pl, recap, _ = _recap_compute(mapping, taux, presta)
    export_rows = [{'Jour': j, 'Entité': ent, 'Choix': r['Choix'], 'Nombres': r['Nombres'],
                    'Pourcentage (%)': round(float(r['Pourcentage']), 1), 'A preparer': r['A preparer']}
                   for j in JOURS for ent in ENTITES for _, r in recap[(j, ent)]['df'].iterrows()]
    buf = io.BytesIO()
    pd.DataFrame(export_rows).to_excel(buf, index=False, sheet_name='Recap')
    buf.seek(0)
    return send_file(buf, download_name='recap_commandes_menus.xlsx',
                     mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=int(os.environ.get('PORT', 5000)))