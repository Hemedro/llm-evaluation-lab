import os
import sys
import time
from pathlib import Path

from fastapi.testclient import TestClient


TEST_DATABASE = Path(__file__).parent / "test_eval_lab.db"
os.environ["EVAL_LAB_DATABASE"] = str(TEST_DATABASE)
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.main import JUDGE_PRESETS, app, model_provider  # noqa: E402


def setup_module():
    TEST_DATABASE.unlink(missing_ok=True)


def teardown_module():
    TEST_DATABASE.unlink(missing_ok=True)


def create_test_dataset(client: TestClient) -> int:
    dataset = client.post(
        "/api/datasets",
        json={
            "name": "API test dataset",
            "description": "User-owned test data.",
            "language_mix": "Arabic / English",
        },
    )
    assert dataset.status_code == 201
    dataset_id = dataset.json()["id"]
    for index in range(2):
        case = client.post(
            f"/api/datasets/{dataset_id}/cases",
            json={
                "title": f"Test case {index + 1}",
                "prompt": f"Return item {index + 1}.",
                "language": "English",
                "category": "Testing",
                "expected_behavior": f"Return item {index + 1}.",
                "rubric": ["instruction_following", "accuracy"],
                "required_terms": [f"item {index + 1}"],
                "forbidden_terms": [],
            },
        )
        assert case.status_code == 201
    return dataset_id


def test_health_and_blank_workspace():
    with TestClient(app) as client:
        health = client.get("/api/health")
        assert health.status_code == 200
        assert health.json()["status"] == "ok"

        datasets = client.get("/api/datasets").json()
        assert datasets == []


def test_openrouter_aliases_use_the_real_provider_name():
    assert model_provider("openai/gpt-4o-mini") == "openai"
    assert model_provider("~openai/gpt-latest") == "openai"


def test_judge_presets_have_unique_models_and_customizable_roles():
    assert {preset["key"] for preset in JUDGE_PRESETS} == {
        "economical",
        "reasoning",
        "strong",
        "independent",
        "bilingual",
    }
    assert len({preset["model"] for preset in JUDGE_PRESETS}) == len(JUDGE_PRESETS)


def test_demo_experiment_and_human_review():
    with TestClient(app) as client:
        dataset_id = create_test_dataset(client)
        response = client.post(
            "/api/experiments",
            json={
                "name": "API test run",
                "dataset_id": dataset_id,
                "models": ["Demo / A", "Demo / B"],
                "judge_model": "Deterministic demo evaluator",
                "mode": "demo",
            },
        )
        assert response.status_code == 201
        experiment = response.json()
        assert experiment["status"] == "completed"
        assert experiment["response_count"] == 4

        detail = client.get(f"/api/experiments/{experiment['id']}").json()
        assert len(detail["responses"]) == 4
        response_id = detail["responses"][0]["id"]

        review = client.post(
            f"/api/responses/{response_id}/human-review",
            json={
                "overall_score": 91,
                "dimensions": {
                    "instruction_following": 5,
                    "accuracy": 4.5,
                    "relevance": 4.5,
                    "language_quality": 4.5,
                    "safety": 5,
                },
                "failure_tags": [],
                "notes": "Human calibration check.",
            },
        )
        assert review.status_code == 200
        assert review.json()["overall_score"] == 91

        overview = client.get("/api/overview")
        assert overview.status_code == 200
        calibration = overview.json()["calibration"]
        automatic_score = detail["responses"][0]["automatic_evaluation"]["overall_score"]
        assert calibration["sample_size"] == 1
        assert calibration["mean_absolute_error"] == round(abs(automatic_score - 91), 1)
        assert calibration["mean_bias"] == round(automatic_score - 91, 1)
        assert calibration["correlation"] is None

        exported = client.get(f"/api/experiments/{experiment['id']}/export.csv")
        assert exported.status_code == 200
        assert "automatic_score" in exported.text


def test_live_run_rejects_secrets_and_malformed_model_ids():
    with TestClient(app) as client:
        datasets = client.get("/api/datasets").json()
        dataset_id = datasets[0]["id"] if datasets else create_test_dataset(client)
        secret_as_model = client.post(
            "/api/experiments",
            json={
                "name": "Secret validation",
                "dataset_id": dataset_id,
                "models": ["sk-or-v1-not-a-model"],
                "judge_model": "openai/gpt-4o-mini",
                "mode": "live",
                "api_key": "test-key",
            },
        )
        assert secret_as_model.status_code == 422
        assert "API key" in secret_as_model.json()["detail"]

        malformed_judge = client.post(
            "/api/experiments",
            json={
                "name": "Judge validation",
                "dataset_id": dataset_id,
                "models": ["openai/gpt-4o-mini"],
                "judge_model": "multi model",
                "mode": "live",
                "api_key": "test-key",
            },
        )
        assert malformed_judge.status_code == 422
        assert "Invalid OpenRouter model ID" in malformed_judge.json()["detail"]
