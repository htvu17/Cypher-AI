from fastapi import FastAPI, HTTPException, Depends, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import create_engine, Column, Integer, String, Float, JSON, Text
from sqlalchemy.orm import sessionmaker, declarative_base, Session
from pydantic import BaseModel
import os
import jwt
import datetime
import json
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from fastapi.responses import StreamingResponse
from contextlib import asynccontextmanager

try:
    from rag_engine import ingest_sample_document, generate_chat_response, generate_recommendations, generate_action_plan, generate_chat_response_stream
except Exception as e:
    print(f"Failed to load RAG engine: {e}")
    ingest_sample_document = lambda: None
    generate_chat_response = lambda q, h: "Error loading AI Engine."
    generate_recommendations = lambda i, a, d: {dom: "Mock recommendations." for dom in d.keys()}
    generate_action_plan = lambda i, o, d: "Mock Action Plan."
    generate_chat_response_stream = lambda q, h: iter(["data: Error loading AI Engine\n\n"])

SECRET_KEY = os.getenv("SECRET_KEY", "super-secret-key-123")
ALGORITHM = "HS256"
security = HTTPBearer()

def verify_token(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
        return payload.get("sub")
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

# Database Setup (Fallback to SQLite for local dev if MySQL is not configured)
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./risk_assessment.db") 

engine = create_engine(
    DATABASE_URL, 
    connect_args={"check_same_thread": False} if "sqlite" in DATABASE_URL else {}
)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()

# Database Models
class AssessmentDB(Base):
    __tablename__ = "assessments"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(50), index=True)
    industry = Column(String(50))
    overall_score = Column(Float)
    domain_scores = Column(JSON)
    raw_answers = Column(JSON)
    status = Column(String(50), default="PENDING")
    recommendations_json = Column(JSON, nullable=True)
    action_plan_text = Column(Text, nullable=True)

Base.metadata.create_all(bind=engine)

@asynccontextmanager
async def lifespan(app: FastAPI):
    ingest_sample_document()
    yield

app = FastAPI(title="Cypher AI CyberSecurity Assessment Tool API", lifespan=lifespan)

# Setup CORS for Vite UI
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

# Pydantic Schemas
class LoginRequest(BaseModel):
    username: str
    password: str

class Answer(BaseModel):
    question_id: int
    score: float 
    text: str

class AssessmentPayload(BaseModel):
    industry: str
    answers: list[Answer]

class ChatMessage(BaseModel):
    message: str
    history: list[dict] = []

# Weights and domains mapping based on requirements
DOMAIN_MAPPING = {
    1: "Access Control",
    2: "Access Control",
    3: "Access Control",
    4: "Data Protection",
    5: "Data Protection",
    6: "Human Security",
    7: "Endpoint Security",
    8: "Endpoint Security",
    9: "Incident Response",
    10: "Incident Response",
}

# Dynamic Industry Matrix Arrays summing to 100
INDUSTRY_WEIGHTS = {
    "Retail & Services": [15, 10, 10, 20, 15, 10, 5, 5, 5, 5],
    "Manufacturing": [10, 10, 5, 5, 25, 10, 10, 10, 10, 5],
    "Healthcare": [15, 10, 10, 20, 15, 10, 5, 5, 5, 5],
    "Finance": [15, 10, 10, 15, 10, 10, 5, 5, 10, 10],
    "Technology": [15, 10, 10, 10, 10, 10, 10, 10, 10, 5]
}

@app.post("/api/login")
def login(req: LoginRequest):
    # Accept any non-empty credentials for demo purposes
    if req.username and req.password:
        expiration = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=8)
        token = jwt.encode({"sub": req.username, "exp": expiration}, SECRET_KEY, algorithm=ALGORITHM)
        return {"status": "success", "username": req.username, "token": token}
    raise HTTPException(status_code=400, detail="Invalid credentials")

@app.get("/api/dashboard")
def get_dashboard(db: Session = Depends(get_db), current_user: str = Depends(verify_token)):
    records = db.query(AssessmentDB).filter(AssessmentDB.username == current_user).all()
    if not records:
        return {"history": []}
    
    return {"history": [
        {
            "id": r.id, 
            "industry": r.industry,
            "overall_score": r.overall_score, 
            "domain_scores": r.domain_scores,
            "status": r.status
        } for r in records
    ]}

async def process_assessment_background(assessment_id: int, industry: str, answers: list, domain_scores: dict, overall_score: float):
    # This runs asynchronously behind the scenes
    db = SessionLocal()
    try:
        ai_recommendations = await generate_recommendations(
            industry=industry,
            answers=answers,
            domain_scores=domain_scores
        )
        ai_action_plan = await generate_action_plan(industry, overall_score, ai_recommendations)
        
        record = db.query(AssessmentDB).filter(AssessmentDB.id == assessment_id).first()
        if record:
            record.recommendations_json = ai_recommendations
            record.action_plan_text = ai_action_plan
            record.status = "COMPLETED"
            db.commit()
    except Exception as e:
        print("Background Processing Error:", e)
        # Even on error, free up the poll state
        record = db.query(AssessmentDB).filter(AssessmentDB.id == assessment_id).first()
        if record:
            record.recommendations_json = {dom: "Error generating recommendation. Please review console." for dom in domain_scores.keys()}
            record.action_plan_text = "The AI Action Plan generator failed critically behind the scenes."
            record.status = "COMPLETED"
            db.commit()
    finally:
        db.close()

@app.post("/api/assessment", status_code=202)
def submit_assessment(payload: AssessmentPayload, background_tasks: BackgroundTasks, db: Session = Depends(get_db), current_user: str = Depends(verify_token)):
    domain_totals = {
        "Access Control": {"score": 0, "weight": 0},
        "Data Protection": {"score": 0, "weight": 0},
        "Human Security": {"score": 0, "weight": 0},
        "Endpoint Security": {"score": 0, "weight": 0},
        "Incident Response": {"score": 0, "weight": 0},
    }
    
    industry = payload.industry
    weights = INDUSTRY_WEIGHTS.get(industry, INDUSTRY_WEIGHTS["Technology"])

    overall_score = 0

    for ans in payload.answers:
        q_id = ans.question_id
        domain = DOMAIN_MAPPING.get(q_id)
        # q_id is 1-10, Array is 0-9
        weight = weights[q_id - 1]
        
        # Math for domain (unscaled yet)
        if domain:
            domain_totals[domain]["score"] += ans.score * weight
            domain_totals[domain]["weight"] += weight
            
        # Math for overall: Σ (Answer_Score_i × Dynamic_Weight_i ÷ 10)
        overall_score += (ans.score * weight) / 10.0

    domain_scores = {}
    for d, vals in domain_totals.items():
        if vals["weight"] > 0:
            # Scale Domain out of 100% Risk Severity
            domain_scores[d] = round((vals["score"] / (vals["weight"] * 10.0)) * 100.0, 2)
        else:
            domain_scores[d] = 0.0

    overall_score = round(overall_score, 2)

    # Save to db with PENDING status
    db_assessment = AssessmentDB(
        username=current_user,
        industry=payload.industry,
        overall_score=overall_score,
        domain_scores=domain_scores,
        raw_answers=[ans.model_dump() for ans in payload.answers],
        status="PENDING"
    )
    db.add(db_assessment)
    db.commit()
    db.refresh(db_assessment)

    # Queue background task for slow AI generations
    background_tasks.add_task(
        process_assessment_background,
        assessment_id=db_assessment.id,
        industry=payload.industry,
        answers=[ans.model_dump() for ans in payload.answers],
        domain_scores=domain_scores,
        overall_score=overall_score
    )

    return {
        "status": "success",
        "assessment_id": db_assessment.id,
        "job_status": "PENDING"
    }

@app.get("/api/assessment-status/{assessment_id}")
def check_assessment_status(assessment_id: int, db: Session = Depends(get_db), current_user: str = Depends(verify_token)):
    record = db.query(AssessmentDB).filter(AssessmentDB.id == assessment_id, AssessmentDB.username == current_user).first()
    if not record:
        raise HTTPException(status_code=404, detail="Not Found")
    
    if record.status != "COMPLETED":
        return {"status": "PENDING"}

    return {
        "status": "COMPLETED",
        "assessment_id": record.id,
        "industry": record.industry,
        "overall_score": record.overall_score,
        "domain_scores": record.domain_scores,
        "recommendations": record.recommendations_json
    }

@app.post("/api/chat")
def chat(payload: ChatMessage, current_user: str = Depends(verify_token)):
    def event_stream():
        try:
            generator = generate_chat_response_stream(query=payload.message, history=payload.history)
            for chunk in generator:
                if chunk:
                    # Replace newlines with a token or break them so SSE stream parsers don't get confused
                    formatted_chunk = chunk.replace('\n', '<br>')
                    yield f"data: {formatted_chunk}\n\n"
        except Exception as e:
            err_str = str(e)
            if "Ratelimit Warning" in err_str:
                yield f"data: ⚠️ AI is currently overloaded. Please wait 30 seconds.\n\n"
            else:
                yield f"data: ERROR: Internal connection failed.\n\n"
    
    return StreamingResponse(event_stream(), media_type="text/event-stream")

@app.get("/api/action-plan/{assessment_id}")
async def get_action_plan(assessment_id: int, db: Session = Depends(get_db), current_user: str = Depends(verify_token)):
    record = db.query(AssessmentDB).filter(AssessmentDB.id == assessment_id, AssessmentDB.username == current_user).first()
    if not record:
        raise HTTPException(status_code=404, detail="Assessment not found")
    
    if record.action_plan_text and record.status == "COMPLETED":
        return {"status": "success", "action_plan": record.action_plan_text}
    
    # Cache-Aside: Generate if missing. Require recommendations dict first.
    recs = record.recommendations_json
    if not recs:
        recs = await generate_recommendations(record.industry, record.raw_answers, record.domain_scores)
        record.recommendations_json = recs

    plan = await generate_action_plan(record.industry, record.overall_score, recs)
    record.action_plan_text = plan
    db.commit()
    return {"status": "success", "action_plan": plan}

@app.get("/api/assessment/{assessment_id}")
async def get_assessment(assessment_id: int, db: Session = Depends(get_db), current_user: str = Depends(verify_token)):
    record = db.query(AssessmentDB).filter(AssessmentDB.id == assessment_id, AssessmentDB.username == current_user).first()
    if not record:
        raise HTTPException(status_code=404, detail="Assessment not found")
    
    # Cache-aside for recommendations natively
    if not record.recommendations_json:
        recs = await generate_recommendations(record.industry, record.raw_answers, record.domain_scores)
        record.recommendations_json = recs
        db.commit()

    return {
        "id": record.id,
        "industry": record.industry,
        "overall_score": record.overall_score,
        "domain_scores": record.domain_scores,
        "recommendations": record.recommendations_json,
        "status": record.status
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
