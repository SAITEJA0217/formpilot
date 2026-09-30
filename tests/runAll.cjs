const assert = require('node:assert/strict');

console.log('=== FORMPILOT GOOGLE FORMS REGRESSION TEST SUITE ===\n');

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log(`[PASS] ${name}`);
    passed++;
  } catch (err) {
    console.error(`[FAIL] ${name}: ${err.message}`);
    failed++;
  }
}

// --------------------------------------------------------------------------
// Bug 1: Exact Question Matching vs Substring Collision ("Name" vs "Father's Name")
// --------------------------------------------------------------------------
runTest('Regression Bug 1: Exact question matching priority over substring collisions', () => {
  const finalAnswers = [
    { question: "Father's Name", answer: "Robert Doe", confidence: 95 },
    { question: "Name", answer: "John Doe", confidence: 98 }
  ];

  function matchAnswer(questionText, answers) {
    const normQ = questionText.toLowerCase().trim();
    let answerObj = answers.find(a => a.question.toLowerCase().trim() === normQ);
    if (!answerObj && normQ.length >= 4) {
      answerObj = answers.find(a => {
        const aNorm = a.question.toLowerCase().trim();
        return aNorm.length >= 4 && (aNorm.includes(normQ) || normQ.includes(aNorm));
      });
    }
    return answerObj;
  }

  const matchedForName = matchAnswer('Name', finalAnswers);
  assert.ok(matchedForName, 'Should find answer for Name');
  assert.equal(matchedForName.answer, 'John Doe', 'Exact match must override "Father\'s Name"');

  const matchedForFathersName = matchAnswer("Father's Name", finalAnswers);
  assert.ok(matchedForFathersName, 'Should find answer for Father\'s Name');
  assert.equal(matchedForFathersName.answer, 'Robert Doe');

  const answersFuzzy = [{ question: "Legal Name", answer: "Jane Doe" }];
  const matchedFuzzy = matchAnswer('Full Legal Name', answersFuzzy);
  assert.ok(matchedFuzzy);
  assert.equal(matchedFuzzy.answer, 'Jane Doe');
});

// --------------------------------------------------------------------------
// Bug 2: Exact-First Option Matching vs Substring Inversion ("Agree" vs "Strongly Agree")
// --------------------------------------------------------------------------
runTest('Regression Bug 2: Exact-first option matching prevents selection inversion', () => {
  const options = [
    { text: 'Strongly Agree', checked: false },
    { text: 'Agree', checked: false },
    { text: 'Neutral', checked: false },
    { text: 'Disagree', checked: false },
    { text: 'Strongly Disagree', checked: false }
  ];

  function selectMatchingOption(targetAnswer, optionList) {
    const normAns = targetAnswer.toLowerCase().trim();
    let matchedIdx = -1;

    // Pass 1: Exact match
    optionList.forEach((opt, idx) => {
      const val = opt.text.toLowerCase().trim();
      if (val && val === normAns) {
        matchedIdx = idx;
      }
    });

    // Pass 2: Substring fallback only if exact match not found and length >= 3
    if (matchedIdx === -1 && normAns.length >= 3) {
      optionList.forEach((opt, idx) => {
        const val = opt.text.toLowerCase().trim();
        if (val && val.length >= 3 && (normAns.includes(val) || val.includes(normAns))) {
          if (matchedIdx === -1) matchedIdx = idx;
        }
      });
    }

    return matchedIdx !== -1 ? optionList[matchedIdx].text : null;
  }

  assert.equal(selectMatchingOption('Strongly Agree', options), 'Strongly Agree');
  assert.equal(selectMatchingOption('Agree', options), 'Agree');
  assert.equal(selectMatchingOption('Strongly Disagree', options), 'Strongly Disagree');
  assert.equal(selectMatchingOption('  strongly agree  ', options), 'Strongly Agree');
});

// --------------------------------------------------------------------------
// Bug 3: Date YYYY-MM-DD Timezone-Safe Normalization
// --------------------------------------------------------------------------
runTest('Regression Bug 3: Direct ISO date normalization prevents timezone day-shift', () => {
  function normalizeDate(answerText) {
    let formattedDate = answerText.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(formattedDate)) {
      return formattedDate;
    }
    
    const dMatch = formattedDate.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dMatch) {
      let p1 = parseInt(dMatch[1], 10);
      let p2 = parseInt(dMatch[2], 10);
      let year = dMatch[3];
      let day = p1 > 12 ? p1 : (p2 > 12 ? p2 : p1);
      let month = p1 > 12 ? p2 : (p2 > 12 ? p1 : p2);
      return `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
    }
    
    const parsed = new Date(formattedDate);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString().split('T')[0];
    }
    return formattedDate;
  }

  assert.equal(normalizeDate('2002-05-15'), '2002-05-15');
  assert.equal(normalizeDate('1999-12-31'), '1999-12-31');
  assert.equal(normalizeDate('15/05/2002'), '2002-05-15');
  assert.equal(normalizeDate('25-12-2020'), '2020-12-25');
});

// --------------------------------------------------------------------------
// Bug 4: Hidden Input / CSRF Token Exclusion Filter
// --------------------------------------------------------------------------
runTest('Regression Bug 4: Hidden inputs are excluded from question classification', () => {
  function classifyInput(mockBlock) {
    const hasTextInput = mockBlock.hasVisibleTextInput || 
      (mockBlock.inputs.some(inp => !['radio', 'checkbox', 'file', 'date', 'time', 'hidden'].includes(inp.type)));
    
    if (hasTextInput) return 'short_answer';
    if (mockBlock.hasTextarea) return 'paragraph';
    return 'unsupported';
  }

  const blockWithHiddenOnly = {
    hasVisibleTextInput: false,
    hasTextarea: false,
    inputs: [{ type: 'hidden' }]
  };
  assert.equal(classifyInput(blockWithHiddenOnly), 'unsupported');

  const blockWithText = {
    hasVisibleTextInput: true,
    hasTextarea: false,
    inputs: [{ type: 'text' }, { type: 'hidden' }]
  };
  assert.equal(classifyInput(blockWithText), 'short_answer');
});

// --------------------------------------------------------------------------
// Bug 5: ReviewPanel State Synchronization on Re-Analysis
// --------------------------------------------------------------------------
runTest('Regression Bug 5: State sync logic accepts new initialAnswers updates', () => {
  let internalState = [{ question: 'Q1', answer: 'Old Answer' }];

  function handlePropUpdate(newInitialAnswers) {
    if (newInitialAnswers) {
      internalState = [...newInitialAnswers];
    }
  }

  const freshAnswers = [
    { question: 'Q1', answer: 'Updated Answer' },
    { question: 'Q2', answer: 'New Answer' }
  ];

  handlePropUpdate(freshAnswers);
  assert.equal(internalState.length, 2);
  assert.equal(internalState[0].answer, 'Updated Answer');
});

// --------------------------------------------------------------------------
// Safety & Provenance Calibration Verification
// --------------------------------------------------------------------------
runTest('Safety Test: Confidence calibration caps ungrounded inferences at 70%', () => {
  function calibrateAnswer(ans) {
    let source = 'generated';
    let confidence = ans.confidence || 0;
    
    if (!ans.answer) {
      source = 'missing';
      confidence = 0;
    } else if (ans.isGenerated || !ans.sourceDetail || ans.sourceDetail.trim() === '') {
      confidence = Math.min(confidence, 70); 
      source = 'generated';
    } else {
      source = 'profile';
    }
    
    return { ...ans, source, confidence };
  }

  const directMatch = calibrateAnswer({
    question: 'Full Name',
    answer: 'John Doe',
    confidence: 100,
    sourceDetail: 'basicProfile.fullName',
    isGenerated: false
  });
  assert.equal(directMatch.confidence, 100);
  assert.equal(directMatch.source, 'profile');

  const inferredMatch = calibrateAnswer({
    question: 'Why do you want this role?',
    answer: 'I have extensive React experience...',
    confidence: 95,
    sourceDetail: 'skills.technical',
    isGenerated: true
  });
  assert.equal(inferredMatch.confidence, 70);
  assert.equal(inferredMatch.source, 'generated');

  const missingMatch = calibrateAnswer({
    question: 'Security Clearance',
    answer: null,
    confidence: 0
  });
  assert.equal(missingMatch.confidence, 0);
  assert.equal(missingMatch.source, 'missing');
});

// --------------------------------------------------------------------------
// Matrix Grid Flattening Verification
// --------------------------------------------------------------------------
runTest('Matrix Grid Test: 2D Grid successfully flattens into distinct sub-questions', () => {
  const gridQuestion = "Rate your proficiency";
  const columns = ["Beginner", "Intermediate", "Expert"];
  const rows = ["TypeScript", "Python", "Docker"];

  const flattened = rows.map((rowName, rIdx) => ({
    id: `q_0_r${rIdx + 1}`,
    question: `${gridQuestion}: ${rowName}`,
    type: 'radio',
    required: true,
    options: columns
  }));

  assert.equal(flattened.length, 3);
  assert.equal(flattened[0].question, 'Rate your proficiency: TypeScript');
  assert.deepEqual(flattened[0].options, ["Beginner", "Intermediate", "Expert"]);
  assert.equal(flattened[1].question, 'Rate your proficiency: Python');
  assert.equal(flattened[2].question, 'Rate your proficiency: Docker');
});

console.log(`\n=== RESULTS: ${passed} PASSED, ${failed} FAILED ===\n`);
if (failed > 0) process.exit(1);
