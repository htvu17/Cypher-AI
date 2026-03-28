import asyncio
import traceback
from rag_engine import generate_recommendations, generate_action_plan, retry_with_backoff_async, generate_chat_response_stream

async def test():
    try:
        print("Testing generating recommendations...")
        res = await generate_recommendations("Technology", [], {"Test Domain": 50})
        print("Success Recommendations:", res)
    except Exception as e:
        print("Error in Recommendations:")
        traceback.print_exc()

    try:
        print("Testing generating action plan...")
        res = await generate_action_plan("Technology", 60.5, {"Test": "Good"})
        print("Success Action Plan:", res)
    except Exception as e:
        print("Error in Action Plan:")
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test())
