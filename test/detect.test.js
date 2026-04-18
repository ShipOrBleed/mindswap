const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createTempProject, cleanup } = require('./helpers');
const { detectProject } = require('../src/detect');

let dir;

function setup() {
  dir = createTempProject('detect-test');
}

function teardown() {
  cleanup(dir);
}

exports.test_detects_npm_package_manager = () => {
  setup();
  try {
    const project = detectProject(dir);
    assert.strictEqual(project.package_manager, 'npm');
  } finally {
    teardown();
  }
};

exports.test_detects_javascript_language = () => {
  setup();
  try {
    const project = detectProject(dir);
    assert.ok(
      project.language.includes('javascript') || project.language.includes('typescript'),
      `expected JS/TS, got: ${project.language}`
    );
  } finally {
    teardown();
  }
};

exports.test_detects_express_framework = () => {
  setup();
  try {
    const project = detectProject(dir);
    assert.strictEqual(project.framework, 'Express');
  } finally {
    teardown();
  }
};

exports.test_detects_jest_test_runner = () => {
  setup();
  try {
    const project = detectProject(dir);
    assert.strictEqual(project.test_runner, 'jest');
  } finally {
    teardown();
  }
};

exports.test_detects_project_name_from_package_json = () => {
  setup();
  try {
    const project = detectProject(dir);
    assert.strictEqual(project.name, 'test-project');
  } finally {
    teardown();
  }
};

exports.test_detects_python_project = () => {
  setup();
  try {
    // Remove JS files, add Python
    fs.unlinkSync(path.join(dir, 'package.json'));
    fs.unlinkSync(path.join(dir, 'package-lock.json'));
    fs.writeFileSync(path.join(dir, 'requirements.txt'), 'fastapi\nuvicorn\n');
    const project = detectProject(dir);
    assert.strictEqual(project.language, 'python');
    assert.strictEqual(project.framework, 'FastAPI');
  } finally {
    teardown();
  }
};

exports.test_detects_go_project = () => {
  setup();
  try {
    fs.unlinkSync(path.join(dir, 'package.json'));
    fs.unlinkSync(path.join(dir, 'package-lock.json'));
    fs.writeFileSync(path.join(dir, 'go.mod'), 'module example.com/foo\n\ngo 1.21\n');
    fs.writeFileSync(path.join(dir, 'go.sum'), '');
    const project = detectProject(dir);
    assert.strictEqual(project.language, 'go');
    assert.strictEqual(project.package_manager, 'go modules');
  } finally {
    teardown();
  }
};

exports.test_detects_docker = () => {
  setup();
  try {
    fs.writeFileSync(path.join(dir, 'Dockerfile'), 'FROM node:18\n');
    const project = detectProject(dir);
    assert.ok(project.tech_stack.includes('docker'), 'should detect docker');
  } finally {
    teardown();
  }
};

exports.test_deduplicates_tech_stack = () => {
  setup();
  try {
    const project = detectProject(dir);
    const unique = new Set(project.tech_stack);
    assert.strictEqual(project.tech_stack.length, unique.size, 'tech_stack should have no duplicates');
  } finally {
    teardown();
  }
};
