from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import session, interview, deep_dive, arch_flow

app = FastAPI(title="The Panel — Interview Assistant", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"http://localhost:\d+",  # all localhost ports for dev
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(session.router)
app.include_router(interview.router)
app.include_router(deep_dive.router)
app.include_router(arch_flow.router)


@app.get("/health")
async def health():
    return {"status": "ok"}
