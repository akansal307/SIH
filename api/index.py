import ctypes
import os
from pathlib import Path


vendor_lib = Path(__file__).with_name("vendor") / "libgomp.so.1"
if vendor_lib.exists():
	ctypes.CDLL(str(vendor_lib), mode=ctypes.RTLD_GLOBAL)
	os.environ["LD_LIBRARY_PATH"] = f"{vendor_lib.parent}:{os.environ.get('LD_LIBRARY_PATH', '')}"


from backend.app.main import app


handler = app
