import React from 'react';
import { createRoot } from 'react-dom/client';
import type { FormQuestion, QuestionType, AIAnswer } from '../../../shared/types';
import ReviewPanel from './ReviewPanel';
import '../style.css';
function extractGoogleFormQuestions(): FormQuestion[] {
  const questions: FormQuestion[] = [];

  // Google Forms structure: div[role="listitem"] represents a question block
  const questionBlocks = document.querySelectorAll('div[role="listitem"]');

  questionBlocks.forEach((block, index) => {
    // Heading div usually contains the question text
    const titleElement = block.querySelector('div[role="heading"]');
    if (!titleElement) return;

    const fullText = titleElement.textContent || '';
    const required = fullText.includes('*');
    const questionText = fullText.replace('*', '').trim();

    let type: QuestionType = 'unsupported';
    const options: string[] = [];

    // Detect Input Types
    const hasTextInput = block.querySelector('input[type="text"], input[type="email"], input[type="number"], input[type="tel"], input[type="url"]') || 
                         (block.querySelector('input') && !block.querySelector('input[type="radio"], input[type="checkbox"], input[type="file"], input[type="date"], input[type="time"]'));
    if (hasTextInput) {
      type = 'short_answer';
    } else if (block.querySelector('textarea')) {
      type = 'paragraph';
    } else if (block.querySelector('input[type="date"]')) {
      type = 'date';
    } else if (block.querySelector('input[type="time"]')) {
      type = 'time';
    } else if (block.querySelector('div[role="grid"]')) {
      // It's a grid! We need to extract the columns first
      const grid = block.querySelector('div[role="grid"]');
      const columnHeaders = grid?.querySelectorAll('div[role="columnheader"]') || [];
      const columns = Array.from(columnHeaders).map(h => h.textContent || '').filter(Boolean);

      const rows = grid?.querySelectorAll('div[role="row"]') || [];

      // Skip the first row (headers), process the rest
      let isCheckboxGrid = !!grid?.querySelector('div[role="checkbox"]');
      let type: QuestionType = isCheckboxGrid ? 'checkbox' : 'radio';

      rows.forEach((row, rIndex) => {
        if (rIndex === 0) return; // Skip header row
        const rowHeader = row.querySelector('div[role="rowheader"]');
        if (rowHeader && rowHeader.textContent) {
          const rowQuestionText = `${questionText}: ${rowHeader.textContent.trim()}`;
          questions.push({
            id: `q_${index}_r${rIndex}`,
            question: rowQuestionText,
            type,
            required,
            options: columns
          });
        }
      });
      return; // Skip normal pushing since we pushed flattened rows
    } else if (block.querySelector('div[role="radiogroup"]')) {
      // Linear Scale or normal Radio
      const isLinearScale = block.querySelectorAll('div[role="radio"]').length > 0 && !!block.querySelector('div[role="presentation"]');
      type = isLinearScale ? 'linear_scale' : 'radio';

      // Extract options
      const labels = block.querySelectorAll('div[role="radio"]');
      labels.forEach(l => {
        const text = l.getAttribute('data-value') || l.getAttribute('aria-label') || '';
        if (text) options.push(text);
      });
    } else if (block.querySelector('div[role="listbox"]')) {
      type = 'dropdown';
      // Dropdown options are often hidden until clicked, but we can try to extract aria-labels or values if present
      const listOptions = block.querySelectorAll('div[role="option"]');
      listOptions.forEach(o => {
        const val = o.getAttribute('data-value');
        if (val && val !== 'Choose') options.push(val);
      });
    } else if (block.querySelectorAll('div[role="checkbox"]').length > 0) {
      type = 'checkbox';
      const checkboxes = block.querySelectorAll('div[role="checkbox"]');
      checkboxes.forEach(c => {
        const val = c.getAttribute('aria-label') || c.getAttribute('data-value') || '';
        if (val) options.push(val);
      });
    }

    if (type !== 'unsupported') {
      questions.push({
        id: `q_${index}`,
        question: questionText,
        type,
        required,
        ...(options.length > 0 ? { options } : {})
      });
    }
  });


  return questions;
}

// Communication with popup or background
chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request.action === 'EXTRACT_QUESTIONS') {
    const questions = extractGoogleFormQuestions();
    sendResponse({ questions });
  } else if (request.action === 'SHOW_REVIEW_PANEL') {
    injectReviewPanel(request.answers);
  }
  return true; // Keep channel open
});

let rootNode: ReturnType<typeof createRoot> | null = null;

function injectReviewPanel(answers: AIAnswer[]) {
  let container = document.getElementById('formpilot-review-root');
  if (!container) {
    container = document.createElement('div');
    container.id = 'formpilot-review-root';
    document.body.appendChild(container);
  }

  if (!rootNode) {
    rootNode = createRoot(container);
  }

  function setNativeInputValue(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
    const valueSetter = Object.getOwnPropertyDescriptor(element, 'value')?.set;
    const prototype = Object.getPrototypeOf(element);
    const prototypeValueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

    if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
      prototypeValueSetter.call(element, value);
    } else if (valueSetter) {
      valueSetter.call(element, value);
    } else {
      element.value = value;
    }

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
  }

  const handleFill = (finalAnswers: AIAnswer[]) => {


    const questionBlocks = document.querySelectorAll('div[role="listitem"]');
    let filledCount = 0;
    let totalCount = 0;

    questionBlocks.forEach((block) => {
      const titleElement = block.querySelector('div[role="heading"]');
      if (!titleElement) return;
      const questionText = (titleElement.textContent || '').replace('*', '').trim();
      const normQ = questionText.toLowerCase().trim();

      // Handle Grid questions
      const grid = block.querySelector('div[role="grid"]');
      if (grid) {
        const rows = grid.querySelectorAll('div[role="row"]');
        rows.forEach((row, rIndex) => {
          if (rIndex === 0) return;
          const rowHeader = row.querySelector('div[role="rowheader"]');
          if (rowHeader && rowHeader.textContent) {
            totalCount++;
            const rowQuestionText = `${questionText}: ${rowHeader.textContent.trim()}`;
            const normRowQ = rowQuestionText.toLowerCase().trim();
            const answerObj = finalAnswers.find(a =>
              a.question === rowQuestionText ||
              a.question.toLowerCase().trim() === normRowQ
            );

            if (answerObj && answerObj.answer) {
              const targetAns = answerObj.answer.toLowerCase().trim();
              const options = row.querySelectorAll('div[role="radio"], div[role="checkbox"]');
              let rowFilled = false;

              options.forEach(opt => {
                const val = (opt.getAttribute('data-value') || opt.getAttribute('aria-label') || '').toLowerCase().trim();
                const isChecked = opt.getAttribute('aria-checked') === 'true';
                if ((targetAns.includes(val) || val.includes(targetAns)) && !isChecked) {
                  (opt as HTMLElement).click();
                  rowFilled = true;
                } else if (isChecked) {
                  rowFilled = true;
                }
              });
              if (rowFilled) filledCount++;
            }
          }
        });
        return;
      }

      // Non-grid question matching using robust normalized strings
      totalCount++;
      const answerObj = finalAnswers.find(a => {
        const aNorm = a.question.toLowerCase().trim();
        return aNorm === normQ || aNorm.includes(normQ) || normQ.includes(aNorm);
      });

      if (!answerObj || !answerObj.answer) return;
      const answerText = answerObj.answer;

      // 1. Date Inputs
      const dateInput = block.querySelector('input[type="date"]') as HTMLInputElement;
      if (dateInput) {
        let formattedDate = answerText;
        const dMatch = answerText.trim().match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
        if (dMatch) {
          let p1 = parseInt(dMatch[1], 10);
          let p2 = parseInt(dMatch[2], 10);
          let year = dMatch[3];
          let day = p1 > 12 ? p1 : (p2 > 12 ? p2 : p1); // default to DD/MM/YYYY if ambiguous
          let month = p1 > 12 ? p2 : (p2 > 12 ? p1 : p2);
          formattedDate = `${year}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
        } else {
          const parsed = new Date(answerText);
          if (!isNaN(parsed.getTime())) {
            formattedDate = parsed.toISOString().split('T')[0];
          }
        }

        try {
          setNativeInputValue(dateInput, formattedDate);
        } catch (e) {
          console.warn("Could not set date format:", formattedDate);
        }
        filledCount++;
        return;
      }

      // 2. Time Inputs
      const timeInput = block.querySelector('input[type="time"]') as HTMLInputElement;
      if (timeInput) {
        setNativeInputValue(timeInput, answerText);
        filledCount++;
        return;
      }

      // 3. Text Inputs (Text, Email, Number, Tel, Url, or generic)
      const textInput = block.querySelector('input[type="text"], input[type="email"], input[type="number"], input[type="tel"], input[type="url"], input:not([type="radio"]):not([type="checkbox"]):not([type="date"]):not([type="time"]):not([type="hidden"])') as HTMLInputElement;
      if (textInput) {
        setNativeInputValue(textInput, answerText);
        filledCount++;
        return;
      }

      // 4. Textareas
      const textarea = block.querySelector('textarea') as HTMLTextAreaElement;
      if (textarea) {
        setNativeInputValue(textarea, answerText);
        filledCount++;
        return;
      }

      // 5. Radio Buttons, Checkboxes, Linear Scale
      const options = block.querySelectorAll('div[role="radio"], div[role="checkbox"]');
      if (options.length > 0) {
        const normAns = answerText.toLowerCase().trim();
        let optionFilled = false;

        options.forEach(opt => {
          const val = (opt.getAttribute('data-value') || opt.getAttribute('aria-label') || '').toLowerCase().trim();
          const isChecked = opt.getAttribute('aria-checked') === 'true';

          if ((normAns.includes(val) || val.includes(normAns)) && !isChecked) {
            (opt as HTMLElement).click();
            optionFilled = true;
          } else if (isChecked) {
            optionFilled = true;
          }
        });
        if (optionFilled) filledCount++;
        return;
      }
      // 6. Dropdowns
      const listbox = block.querySelector('div[role="listbox"]');
      if (listbox) {
        (listbox as HTMLElement).click();
        setTimeout(() => {
          const listOptions = document.querySelectorAll('div[role="option"]');
          const normAns = answerText.toLowerCase().trim();
          listOptions.forEach(o => {
            const val = (o.getAttribute('data-value') || o.textContent || '').toLowerCase().trim();
            if (val === normAns || normAns.includes(val)) {
              (o as HTMLElement).click();
              filledCount++;
            }
          });
        }, 150);
      }
    });
    toastMessage(`Form autofilled (${filledCount} of ${totalCount} fields filled)!`);
  };
  function toastMessage(msg: string) {
    const t = document.createElement('div');
    t.innerText = msg;
    t.style.position = 'fixed';
    t.style.bottom = '20px';
    t.style.right = '20px';
    t.style.background = '#4CAF50';
    t.style.color = 'white';
    t.style.padding = '12px 24px';
    t.style.borderRadius = '8px';
    t.style.zIndex = '999999';
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 3000);
  }
  const handleClose = () => {
    if (rootNode) {
      rootNode.unmount();
      rootNode = null;
    }
    if (container) {
      container.remove();
    }
  };
  rootNode.render(
    <React.StrictMode>
      <ReviewPanel answers={answers} onFill={handleFill} onClose={handleClose} />
    </React.StrictMode>
  );
}
