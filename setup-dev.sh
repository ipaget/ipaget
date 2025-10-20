#!/bin/bash

set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
GRAY='\033[0;90m'
NC='\033[0m'

echo -e "${GREEN}Setting up iPAGet development environment...${NC}"
echo ""

# Check Node.js
echo -e "${CYAN}Checking Node.js...${NC}"
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found. Please install from https://nodejs.org/${NC}"
    exit 1
else
    NODE_VERSION=$(node --version)
    echo -e "${GREEN}✓ Node.js $NODE_VERSION installed${NC}"
fi

# Check pnpm
echo -e "${CYAN}Checking pnpm...${NC}"
if ! command -v pnpm &> /dev/null; then
    echo -e "${YELLOW}Installing pnpm...${NC}"
    npm install -g pnpm
else
    PNPM_VERSION=$(pnpm --version)
    echo -e "${GREEN}✓ pnpm $PNPM_VERSION installed${NC}"
fi

# Check Rust
echo -e "${CYAN}Checking Rust...${NC}"
if ! command -v cargo &> /dev/null; then
    echo -e "${RED}❌ Rust not found. Please install from https://rustup.rs/${NC}"
    exit 1
else
    RUST_VERSION=$(rustc --version)
    echo -e "${GREEN}✓ $RUST_VERSION installed${NC}"
fi

# Check Go
echo -e "${CYAN}Checking Go...${NC}"
if ! command -v go &> /dev/null; then
    echo -e "${RED}❌ Go not found. Please install from https://go.dev/dl/${NC}"
    exit 1
else
    GO_VERSION=$(go version)
    echo -e "${GREEN}✓ $GO_VERSION installed${NC}"
fi

# Note: Air will be run via 'go run' - no installation needed
echo -e "${GREEN}✓ Air will be used via 'go run' (no installation required)${NC}"

# Install frontend dependencies
echo ""
echo -e "${CYAN}Installing frontend dependencies...${NC}"
pnpm install
echo -e "${GREEN}✓ Frontend dependencies installed${NC}"

# Install Go dependencies
echo ""
echo -e "${CYAN}Installing Go dependencies...${NC}"
cd go-service
go mod download
cd ..
echo -e "${GREEN}✓ Go dependencies installed${NC}"

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✓ Setup complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "${YELLOW}To start development server, run:${NC}"
echo -e "${CYAN}  pnpm tauri dev${NC}"
echo ""
echo -e "${GRAY}For more information, see DEVELOPMENT.md${NC}"

