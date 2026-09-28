"""Protocol cross-check: emit known-good frames as hex from the Python side.

Run alongside the Node script of the same name; the hex output must match
byte for byte, which proves the two implementations agree on the wire format.
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import protocol as proto  # noqa: E402

cases = {
    "mic_640": proto.encode_mic(bytes(640)),
    "mic_final": proto.encode_mic(bytes(640), final=True),
    "audio_out_960": proto.encode_audio_out(bytes(960)),
    "audio_out_final": proto.encode_audio_out(bytes(960), final=True),
    "image_jpeg": proto.encode_image(b"\xff\xd8abc", proto.ImageCodec.JPEG),
    "image_webp": proto.encode_image(b"RIFFabc", proto.ImageCodec.WEBP),
    "control": proto.encode_control({"type": "CLEAR_BUFFER", "reason": "barge_in"}),
}

for name, data in cases.items():
    # Print a digest of the full frame plus the header, so the Node side can
    # compare without dumping kilobytes of zeros.
    header = data[:2].hex()
    payload = data[2:]
    import hashlib

    print(f"{name} header={header} len={len(data)} sha256={hashlib.sha256(data).hexdigest()[:16]}")

# Also assert the decode path round-trips.
assert proto.decode_frame(cases["mic_final"]).is_final
assert proto.decode_frame(cases["control"]).as_control()["reason"] == "barge_in"
print("PY_PROTOCOL_OK")
