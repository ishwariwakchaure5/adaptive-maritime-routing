cmake_minimum_required(VERSION 3.16)
project(daa_path_server CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ── Dependencies ──────────────────────────────────────────────────────────────

include(FetchContent)

# Crow — header-only HTTP framework (bundles asio)
FetchContent_Declare(
  Crow
  GIT_REPOSITORY https://github.com/CrowCpp/Crow.git
  GIT_TAG        v1.2.0
)
FetchContent_MakeAvailable(Crow)

# nlohmann/json — header-only JSON library
FetchContent_Declare(
  nlohmann_json
  GIT_REPOSITORY https://github.com/nlohmann/json.git
  GIT_TAG        v3.11.3
)
FetchContent_MakeAvailable(nlohmann_json)

# ── Sources ───────────────────────────────────────────────────────────────────

add_executable(daa_path_server
  src/main.cpp
  src/astar.cpp
  src/vector_field.cpp
  src/step_simulator.cpp
  src/routes.cpp
)

target_include_directories(daa_path_server PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/src
)

target_link_libraries(daa_path_server PRIVATE
  Crow::Crow
  nlohmann_json::nlohmann_json
)

# Silence Crow's deprecation warnings on MSVC
if(MSVC)
  target_compile_options(daa_path_server PRIVATE /W3 /wd4996)
else()
  target_compile_options(daa_path_server PRIVATE -Wall -Wextra -Wno-deprecated-declarations)
endif()
