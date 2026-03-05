"""Flask application for WBCP Interactive Uncertainty Visualization."""
import os
import secrets
from flask import Flask
from flask_cors import CORS

from config import BASE_DIR, UPLOADS_DIR


def create_app():
    app = Flask(
        __name__,
        static_folder=os.path.join(BASE_DIR, "static"),
        template_folder=os.path.join(BASE_DIR, "templates"),
    )
    app.secret_key = os.environ.get("FLASK_SECRET_KEY", "wbcp-dev-key-do-not-use-in-prod")
    app.config["MAX_CONTENT_LENGTH"] = 50 * 1024 * 1024  # 50MB
    CORS(app)

    os.makedirs(UPLOADS_DIR, exist_ok=True)

    from backend.routes.dataset_routes import dataset_bp
    from backend.routes.model_routes import model_bp
    from backend.routes.analysis_routes import analysis_bp

    app.register_blueprint(dataset_bp, url_prefix="/api")
    app.register_blueprint(model_bp, url_prefix="/api")
    app.register_blueprint(analysis_bp, url_prefix="/api")

    @app.route("/")
    def index():
        from flask import render_template
        return render_template("index.html")

    return app


# Module-level app instance for gunicorn (gunicorn app:app)
app = create_app()

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5000))
    debug = os.environ.get("FLASK_DEBUG", "1") == "1"
    app.run(debug=debug, host="0.0.0.0", port=port)