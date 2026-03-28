import asyncio
from rag_engine import generate_chat_response_stream

async def test():
    try:
        gen = generate_chat_response_stream("Hello", [])
        for chunk in gen:
            print("CHUNK:", chunk)
    except Exception as e:
        print("ERROR:", e)

if __name__ == "__main__":
    asyncio.run(test())
