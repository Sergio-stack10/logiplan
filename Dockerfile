FROM python:3.11-slim

WORKDIR /app

# 1. Installer les dépendances Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 2. Copier le code de l'application
COPY . .

# 3. Port d'écoute (Koyeb utilise le port 8000 par défaut)
ENV PORT=8000
EXPOSE 8000

# 4. Démarrage du serveur
CMD ["sh", "-c", "gunicorn --bind 0.0.0.0:${PORT} --timeout 120 main:app"]