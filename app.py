"""Serveur local du tableau de bord GPX/TCX. Démarrer avec python3 app.py."""

from email.parser import BytesParser
from email.policy import default
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from urllib.parse import urlsplit

from analyzer import AnalysisError, MAX_FILE_BYTES, analyze
from comparison import compare_ranges, preview

HERE = Path(__file__).resolve().parent
HOST = "127.0.0.1"
PORT = 8765
MAX_REQUEST_BYTES = 2 * MAX_FILE_BYTES + 32 * 1024
CRLF = bytes([13, 10])
LOCAL_ORIGINS = {f"http://{host}:{PORT}" for host in ("127.0.0.1", "localhost")}


def load_default_files(config_path: Path = HERE / "local-traces.json") -> dict[str, Path]:
    """Load optional, private GPX filenames strictly from the user's Downloads folder."""
    try:
        config = json.loads(config_path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        return {}
    except (OSError, UnicodeError, ValueError) as exc:
        raise AnalysisError("Configuration local-traces.json illisible ou invalide.") from exc
    if not isinstance(config, dict) or set(config) - {"first", "second"}:
        raise AnalysisError("local-traces.json doit contenir uniquement first et second.")
    paths = {}
    for side, filename in config.items():
        if (not isinstance(filename, str) or not filename or filename in {".", ".."}
                or Path(filename).name != filename or "/" in filename or chr(92) in filename
                or Path(filename).suffix.lower() != ".gpx"):
            raise AnalysisError("Les traces préchargées doivent être des noms de GPX situés dans Downloads.")
        paths[side] = Path.home() / "Downloads" / filename
    return paths


DEFAULT_FILES = load_default_files()


def default_trace(identifier: str) -> bytes:
    """Only locally configured Downloads filenames may be read via HTTP."""
    if identifier not in ("first", "second"):
        raise AnalysisError("Trace préchargée inconnue.")
    path = DEFAULT_FILES.get(identifier)
    if path is None:
        raise AnalysisError("Aucun GPX préchargé pour cette trace. Choisissez un GPX manuellement.")
    try:
        if path.stat().st_size > MAX_FILE_BYTES:
            raise AnalysisError("Le fichier préchargé dépasse 50 Mio.")
        return path.read_bytes()
    except PermissionError as exc:
        raise AnalysisError(f"Lecture refusée par le système pour {path.name}. Choisissez un GPX manuellement.") from exc
    except FileNotFoundError as exc:
        raise AnalysisError(f"{path.name} est absent de Downloads. Choisissez un GPX manuellement.") from exc
    except OSError as exc:
        raise AnalysisError(f"Impossible de lire {path.name} ({exc.strerror or 'erreur système'}). Choisissez un GPX manuellement.") from exc


def compare_file(fields: dict, key: str) -> bytes:
    has_file = key in fields
    has_default = key + "_default" in fields
    if has_file == has_default:
        raise AnalysisError("Choisissez un fichier importé ou une trace préchargée pour chaque côté.")
    return fields[key] if has_file else default_trace(fields[key + "_default"])


class Handler(BaseHTTPRequestHandler):
    def local_request(self) -> bool:
        """Reject remote origins and DNS rebinding to local GPX endpoints."""
        host = self.headers.get("Host", "")
        origin = self.headers.get("Origin")
        site = self.headers.get("Sec-Fetch-Site")
        if (f"http://{host}" not in LOCAL_ORIGINS or
                (origin is not None and origin not in LOCAL_ORIGINS) or
                (site is not None and site not in {"none", "same-origin"})):
            self.send_error(403, "Accès réservé au navigateur local.")
            return False
        return True

    def send_body(self, status: int, body: bytes, mime: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'")
        self.end_headers()
        self.wfile.write(body)

    def json_response(self, status: int, result: dict) -> None:
        self.send_body(status, json.dumps(result, ensure_ascii=False, allow_nan=False).encode("utf-8"),
                       "application/json; charset=utf-8")

    def do_GET(self) -> None:
        if not self.local_request():
            return
        if urlsplit(self.path).path == "/api/default-traces":
            items = {}
            for identifier in ("first", "second"):
                path = DEFAULT_FILES.get(identifier)
                name = path.name if path else "Trace " + ("1" if identifier == "first" else "2")
                try:
                    items[identifier] = {"name": name, "preview": preview(default_trace(identifier))}
                except AnalysisError as exc:
                    items[identifier] = {"name": name, "error": str(exc)}
            self.json_response(200, {"traces": items})
            return
        routes = {"/": ("index.html", "text/html; charset=utf-8"),
                  "/logo.svg": ("logo.svg", "image/svg+xml"),
                  "/app.js": ("app.js", "text/javascript; charset=utf-8"),
                  "/compare.js": ("compare.js", "text/javascript; charset=utf-8"),
                  "/styles.css": ("styles.css", "text/css; charset=utf-8")}
        route = routes.get(urlsplit(self.path).path)
        if route is None:
            self.send_error(404)
            return
        self.send_body(200, (HERE / route[0]).read_bytes(), route[1])

    def do_POST(self) -> None:
        if not self.local_request():
            return
        route = urlsplit(self.path).path
        if route not in ("/api/analyze", "/api/compare", "/api/preview"):
            self.send_error(404)
            return
        try:
            try:
                length = int(self.headers.get("Content-Length", ""))
            except ValueError as exc:
                raise AnalysisError("Longueur de la requête manquante ou invalide.") from exc
            request_limit = MAX_REQUEST_BYTES if route == "/api/compare" else MAX_FILE_BYTES + 16 * 1024
            if not 0 < length <= request_limit:
                raise AnalysisError("Import trop volumineux (limite : 50 Mio par fichier).")
            content_type = self.headers.get("Content-Type", "")
            if not content_type.lower().startswith("multipart/form-data;"):
                raise AnalysisError("Un formulaire avec un fichier GPX ou TCX est attendu.")
            raw = self.rfile.read(length)
            if len(raw) != length:
                raise AnalysisError("Import incomplet.")
            header = b"MIME-Version: 1.0" + CRLF + b"Content-Type: " + content_type.encode("ascii", "strict") + CRLF * 2
            message = BytesParser(policy=default).parsebytes(header + raw)
            if not message.is_multipart():
                raise AnalysisError("Formulaire multipart invalide.")
            fields = {}
            allowed = ({"reference_file", "challenger_file", "reference_file_default", "challenger_file_default",
                        "first_start_m", "first_end_m", "second_start_m", "second_end_m",
                        "cadence_first", "cadence_second"} if route == "/api/compare" else
                       {"file", "default_id"} if route == "/api/preview" else
                       {"file", "sport", "cadence_mode", "z2_min", "z3_min", "z4_min", "z5_min"})
            file_fields = {"reference_file", "challenger_file"} if route == "/api/compare" else {"file"}
            for part in message.iter_parts():
                field = part.get_param("name", header="content-disposition")
                if field not in allowed or field in fields:
                    raise AnalysisError("Champs du formulaire invalides ou répétés.")
                value = part.get_payload(decode=True)
                if value is None:
                    raise AnalysisError("Fichier illisible.")
                if field in file_fields:
                    if part.get_filename() is None or len(value) > MAX_FILE_BYTES:
                        raise AnalysisError("Fichier manquant ou supérieur à 50 Mio.")
                    fields[field] = value
                else:
                    if len(value) > 100:
                        raise AnalysisError("Paramètre de formulaire trop long.")
                    fields[field] = value.decode("utf-8", "strict")
            if route == "/api/preview":
                if set(fields) not in ({"file"}, {"default_id"}):
                    raise AnalysisError("Choisissez un GPX ou une trace préchargée pour l’aperçu.")
                self.json_response(200, preview(fields["file"] if "file" in fields else default_trace(fields["default_id"])))
                return
            if route == "/api/compare":
                expected = {"first_start_m", "first_end_m", "second_start_m", "second_end_m",
                            "cadence_first", "cadence_second"}
                if not expected.issubset(fields):
                    raise AnalysisError("Les quatre bornes et les deux réglages de cadence sont requis.")
                try:
                    bounds = [float(fields[key]) for key in ("first_start_m", "first_end_m",
                                                              "second_start_m", "second_end_m")]
                except ValueError as exc:
                    raise AnalysisError("Les bornes doivent être des distances valides en mètres.") from exc
                self.json_response(200, compare_ranges(compare_file(fields, "reference_file"),
                                                        compare_file(fields, "challenger_file"),
                                                        *bounds, fields["cadence_first"], fields["cadence_second"]))
                return
            if set(fields) != allowed:
                raise AnalysisError("Fichier, sport, convention de cadence et quatre seuils cardiaques requis.")
            try:
                z2, z3, z4, z5 = (int(fields[f"z{i}_min"]) for i in range(2, 6))
            except ValueError as exc:
                raise AnalysisError("Les seuils doivent être des nombres entiers.") from exc
            self.json_response(200, analyze(fields["file"], fields["sport"], z2, z3, z4, z5,
                                            fields["cadence_mode"]))
        except (AnalysisError, UnicodeError) as exc:
            self.json_response(400, {"error": str(exc)})
        except (BrokenPipeError, ConnectionResetError):
            pass


def main() -> None:
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"Palantir : http://{HOST}:{PORT} (Ctrl+C pour arrêter)", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
