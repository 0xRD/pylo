import os

os.environ.setdefault("PYLO_ENV", "test")
os.environ.setdefault("SECRET_KEY", "test_secret_key_for_pylo_security_tests_32")
os.environ.setdefault("ENCRYPTION_KEY", "test_encryption_key_for_pylo_security_32")
os.environ.setdefault("API_TOKEN", "test_api_token_for_pylo_security_tests_32")
os.environ.setdefault("PYBOOKS_STORAGE_PATH", "/tmp/pybooks_storage")
