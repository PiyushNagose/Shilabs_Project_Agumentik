import argparse
import json
import struct
import sys

from vosk import KaldiRecognizer, Model


def read_chunk():
    header = sys.stdin.buffer.read(4)
    if not header or len(header) < 4:
        return None
    size = struct.unpack(">I", header)[0]
    if size == 0:
        return b""
    data = sys.stdin.buffer.read(size)
    if len(data) < size:
        return None
    return data


def emit(payload):
    sys.stdout.write(json.dumps(payload) + "\n")
    sys.stdout.flush()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", required=True)
    parser.add_argument("--sample-rate", required=True, type=int)
    args = parser.parse_args()

    model = Model(args.model)
    recognizer = KaldiRecognizer(model, args.sample_rate)

    while True:
        chunk = read_chunk()
        if chunk is None:
            break
        if len(chunk) == 0:
            result = json.loads(recognizer.FinalResult())
            text = (result.get("text") or "").strip()
            if text:
                emit({"type": "final", "text": text})
            break
        if recognizer.AcceptWaveform(chunk):
            result = json.loads(recognizer.Result())
            text = (result.get("text") or "").strip()
            if text:
                emit({"type": "final", "text": text})


if __name__ == "__main__":
    main()
