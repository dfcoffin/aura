/*
 * Copyright (C) 2013 salesforce.com, inc.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *         http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

function lib(w) { //eslint-disable-line no-unused-vars
    'use strict';
    w || (w = window);

    var KeyboardNavManager = function () {
    };

    KeyboardNavManager.prototype = {

        /**
         * Initialize Key Nav Manager Entry
         * @param cmp
         */
        initKeyboardEntry: function (cmp) {
            if (!this.initialized) {
                this.cmp = cmp;
                this.table = this.grid = cmp.find('grid').getElement();
                this.handlersAdded = false;
                this.tableBody = this.grid.querySelector('tbody');
                this.tableHead = this.grid.querySelector('thead');

                this._onClickHandler = this._onClick.bind(this);
                this.grid.addEventListener("click", this._onClickHandler, true);

                this._onDoubleClickHandler = this._onDoubleClick.bind(this);
                this.grid.addEventListener("dblclick", this._onDoubleClickHandler, true);

                this.initialized = true;
            }
        },

        /**
         * Destroy Key Nav Manager
         * @param cmp
         */
        destroyKeyboard: function () {
            if (this.initialized) {
                this.initialized = false;
                if (this.handlersAdded) {
                    this._removeEventHandlers();
                }
                this.grid.removeEventListener("dblclick", this._onDoubleClickHandler, true);
                this._onDoubleClickHandler = null;
                this.grid.removeEventListener("click", this._onClickHandler, true);
                this._onClickHandler = null;
                this.tableHead = null;
                this.tableBody = null;
                this.table = null;
                this.handlersAdded = false;
                this.grid = null;
                this.cmp = null;
            }
        },

        pauseKeyboardMode: function(){
            if (!this.initialized) {
                // if the keyboard navigation feature has not been initialized, it was deactivated
                return;
            }
            this.keyboardModePaused = true;
        },

        /**
         * TODO: This function needs to know whether the panel was closed due to a tab key or not
         * to be able to select the next or previous (for shift tab) column and then start editing
         * that cell immediately
         */
        resumeKeyboardMode: function(skipActivation) {
            if (!this.initialized) {
                // if the keyboard navigation feature has not been initialized, it was deactivated
                return;
            }
            this.keyboardModePaused = false;

            if (!skipActivation) {
                // need to stop any further key handling
                // but wait we have no evet, and in the earlier code path we cannot stop it either.
                // needs further investigation
                //evt.preventDefault();
                //evt.stopPropagation();

                // workaround: better performance gains with use of requestAnimationFrame to let a small amount of time pass
                window.requestAnimationFrame($A.getCallback(function() {
                    // we use the row index and column index here because in rerender scenarios the active cell is an outdated dom element
                    this._setActiveCell(this.activeRowIndex, this.activeColumnIndex, false);
                }.bind(this)));
            }

        },

        /**
         * Add Event Handlers (click/keydown) for interacting with the grid
         */
        _addEventHandlers: function(){
            this._onKeydownHandler = this._onKeydown.bind(this);
            this.grid.addEventListener("keydown", this._onKeydownHandler, true);
            this.handlersAdded = true;
        },

        /**
         * Unbind keyboard and click Nav events
         */
        _removeEventHandlers: function () {
            this.grid.removeEventListener("keydown", this._onKeydownHandler, true);
            this._onKeydownHandler = null;
            this.handlersAdded = false;
        },

        /**
         * Enters the keyboard mode status of the specified cmp
         * @param cmp
         */
        enterKeyboardMode: function(cmp, startEdit, skipCellHandling) {
            if (!this.initialized) {
                // if the keyboard navigation feature has not been initialized, it was deactivated
                return;
            }
            if (!this.handlersAdded){
                this._addEventHandlers();
            }

            this.inKeyboardMode = true;

            cmp.set('v.inKeyboardMode', true);

            if (!skipCellHandling) {
                if (!this._activeCellExists()){
                    this._initActiveCell(startEdit);
                }

                if (startEdit){
                    this._triggerEditOnActiveCell();
                }
                else {
                    this._focusActiveCellInput();
                }
            }

        },

        /**
         * Exits the keyboard mode status of the specified cmp
         * @param cmp
         */
        exitKeyboardMode: function(cmp) {
            if (!this.initialized) {
                // if the keyboard navigation feature has not been initialized, it was deactivated
                return;
            }
            this.inKeyboardMode = false;
            this._removeEventHandlers();
            cmp.set('v.inKeyboardMode', false);
            cmp.helper.fireKeyboardModeExitEvent(cmp);
            this._blurActiveCellInput();
            this.grid.blur();
        },

        /**
         * Sets the active cell and active input in the table body
         * @param cmp
         */
        _initActiveCell: function(mustBeTriggerCell){

            var rowLength = this._getRowLength();
            // Find and set the active cell based on just the dom
            // we start at 1 because 0 is the header
            for (var rowIndex=1; rowIndex<rowLength; rowIndex++){

                var columnIndex = this._findUsableColumnInRow(true, rowIndex, true, mustBeTriggerCell);
                if (columnIndex !== -1) {
                    this._setActiveCell(rowIndex, columnIndex);
                    this._blurActiveCellInput();
                    break;
                }

            }
        },

        /**
         * Returns the number of rows including the header
         */
        _getRowLength: function() {
            return this.tableBody.rows.length + 1; // one for the header
        },

        /**
         * Returns the row (across header and body) for the given zero-based index, including the header on 0
         */
        _getRow: function(rowIndex) {
            return (rowIndex===0) ? this.tableHead.rows[0] : this.tableBody.rows[rowIndex-1];
        },

        /**
         * Returns true if the given node is in the header row
         */
        _isHeaderRow: function(domNode) {
            return this.tableHead.contains(domNode);
        },

        /**
         * This function looks at all columns and returns the first or last usable cell based on search parameters
         *
         * @param firstColumn if true it finds the first usable column, otherwise the last
         * @param rowIndex the row to query
         * @param mustContainFocusableElement if true the cell must contain button, input or a
         * @param mustBeTriggerCell must be a trigger cell
         */
        _findUsableColumnInRow: function(firstColumn, rowIndex, mustContainFocusableElement, mustBeTriggerCell) {
            if (this._targetRowAvailable(rowIndex)) {
                var columns = this._getRow(rowIndex).cells;
                for (var counter = 0; counter < columns.length; counter++) {
                    var columnIndex = (firstColumn)?counter:columns.length-counter-1,
                        node;
                    if (mustBeTriggerCell) {
                        // First active cell must not be disabled and must contain a trigger button
                        if (this._cellIsEditable(rowIndex, columnIndex)) {
                            return columnIndex;
                        }
                    }
                    else if (mustContainFocusableElement) {
                        // First active cell must not be disabled and must contain any input element
                        node = columns[columnIndex].querySelector('button, input, a');
                        if (node !== null && !this.isElementHidden(node)) {
                            return columnIndex;
                        }
                    }
                    else {
                        // First active cell must not be disabled or hidden
                        node = columns[columnIndex];
                        if (node !== null && !this.isElementHidden(node)) {
                            return columnIndex;
                        }
                    }
                }
            }
            return -1;
        },

        /**
         * Returns whether a given element is hidden or not.
         * This is needed because in the product we have columns which are hidden with css and we need to skip those
         */
        isElementHidden: function(elem) {
            return (elem.offsetParent === null);
        },

        /**
         * Triggers the inline edit on the active cell or if not found starts on the top of the grid
         * @param doNotStartFromTheTop if set to true this function won't start of the top of the grid
         */
        _triggerEditOnActiveCell: function(doNotStartFromTheTop) {
            if (!this._cellIsEditable(this.activeRowIndex, this.activeColumnIndex)){
                if (doNotStartFromTheTop) {
                    return;
                }
                // if we are on a non-editable cell we simply start from the top
                this._initActiveCell(true);
            }
            // now we can trigger the edit action
            var trigger = this._getTriggerOfCellNode(this.activeCell);
            if (trigger) {
                trigger.click();
            }

        },

        /**
         * Returns an array of all focusable elements (input, button, a) which are not hidden and not disabled
         *
         * @param cellElement the cell to get the focusable elements for
         * @param allInputs won't skip any input elements. This is the TAB usecase
         */
        _getFocusableElements: function(cellElement, allInputs) {
            var focusableElements = Array.prototype.slice.call(this.activeCell.querySelectorAll('button, input, a'));
            focusableElements = this._filterHiddenElements(focusableElements);
            focusableElements = this._filterDisabledTriggers(focusableElements);
            if (!allInputs) {
                focusableElements = this._filterSkippedNavigationElements(focusableElements);
            }
            return focusableElements;
        },

        /**
         * Filters all disabled trigger elements from the given array
         */
        _filterDisabledTriggers: function(elements) {
            return $A.util.filter(elements,
                function (element) {
                    var isTrigger = this._isTrigger(element);
                    return (isTrigger)?!this._isTriggerDisabledByElement(element):true;
                }.bind(this));
        },

        /**
         * Filters all hidden elements from the given array
         */
        _filterHiddenElements: function(elements) {
            return $A.util.filter(elements,
                function (element) {
                    return !this.isElementHidden(element);
                }.bind(this));
        },

        /**
         * Filters all elements that have the class 'keyboardMode--skipArrowNavigation' set
         */
        _filterSkippedNavigationElements: function(elements) {
            return $A.util.filter(elements,
                function (element) {
                    return !element.classList.contains("keyboardMode--skipArrowNavigation");
                });
        },

        /**
         * Returns true if the trigger in this cell is set to disabled or hidden (which happens if v.editable is set to false)
         */
        _isTriggerDisabled: function(rowIndex, columnIndex) {
            var trigger = this._getTriggerOfCellNode(this._getRow(rowIndex).cells[columnIndex]);
            if (!trigger) {
                return true; // no trigger means disabled
            }
            return this._isTriggerDisabledByElement(trigger);
        },

        /**
         * Returns true if the trigger of this element is set to disabled or hidden (which happens if v.editable is set to false)
         */
        _isTriggerDisabledByElement: function(element) {
            return element.classList.contains("disabled") || this.isElementHidden(element);
        },

        _isTrigger: function(element) {
            return element.classList.contains("trigger");
        },

        _getTriggerOfCellNode: function(cellNode) {
            return cellNode.querySelector('.trigger');
        },

        /**
         * Removes focus from the active cell input
         */
        _blurActiveCellInput: function(){
            document.activeElement && document.activeElement.blur();
        },

        /**
         * Focuses the active cell input
         */
        _focusActiveCellInput: function(){

            if (this._activeCellExists()) {
                // this only returns visible elements and non disabled triggers
                var focusableElements = this._getFocusableElements(this.activeCell);

                if (focusableElements.length>0) { // if there is at least one input which is also visible
                    if (this.activeCellInput && !this.isElementHidden(this.activeCellInput)) {
                        // try to focus the input element that was calculated earlier
                        this._focusElement(this.activeCellInput);
                    } else {
                        // if that is not possible, focus the first visible one
                        this._focusElement(focusableElements[0]);
                    }
                } else {
                    // if there is no visible, focusable element, simply select the first one (which should be the inner span)
                    this._focusElement(this.activeCell.firstChild);
                }
            }
        },

        _focusElement: function(element) {
            if (element) {
                element.focus();
                if (element.classList.contains("keyboardMode--pauseOnFocus")) {
                    this.pauseKeyboardMode();
                    this._onAutoResumeKeyboardModeHandler = this._onAutoResumeKeyboardMode.bind(this);
                    element.addEventListener("blur", this._onAutoResumeKeyboardModeHandler, true);
                }
            }
        },

        _onAutoResumeKeyboardMode: function(e) {
            e.target.removeEventListener("blur", this._onAutoResumeKeyboardModeHandler, true);
            this._onAutoResumeKeyboardModeHandler = null;

            var cellLocation = this._getClickedCellLocation(e);
            this._setActiveCell(cellLocation.row, cellLocation.column);

            this.resumeKeyboardMode(true);
        },

        /**
         * Returns true if an active cell has been set
         * or when the active cell is not part of this grid's DOM
         */
        _activeCellExists: function(){
            return !$A.util.isUndefinedOrNull(this.activeCell) && this.table.contains(this.activeCell);
        },

        /**
         * Returns true if an active cell is set and contains an input element
         */
        _activeCellInputExists: function(){
            return this._activeCellExists() && !$A.util.isUndefinedOrNull(this.activeCell.querySelector('button, input, a'));
        },

        /**
         * Returns true if the target column index is in range of the activeRow
         * This includes checking for the index for out of bounds, plus checking
         * Whether columns are hidden and therefore not available
         *
         * @param columnIndex
         */
        _targetColumnAvailable: function(rowIndex, columnIndex){
            var row = this._getRow(rowIndex),
                inRange = this._targetInRange(columnIndex, 0, row.cells.length); // target, min, max
            if (inRange) {
                var element = row.cells[columnIndex];
                return !this.isElementHidden(element);
            }
            return inRange;
        },

        /**
         * Returns true if the target row index is in range of the grid row length
         * @param rowIndex - index of the row
         */
        _targetRowAvailable: function(rowIndex){
            return this._targetInRange(rowIndex, 0, this._getRowLength()); // target, min, max
        },

        /**
         * Helper function returns true if target is in range of min and max values
         * @param target - Target value to test in range
         * @param min - Min value in range
         * @param max - Max value in range
         */
        _targetInRange: function(target, min, max){
            return target < max && target >= min;
        },

        /**
         * Set cell at row and column active, active == add class to TD and focus on input
         * @param rowIndex - index of the row
         * @param columnIndex - index of the column
         * @param triggerEdit (optional) - Flag to trigger the inline edit on the activeCell
         * @param selectLastInput if true, the last input element is selected within the column
         * @param allInputs = won't skip any input elements. This is the TAB usecase
         */
        _setActiveCell: function (rowIndex, columnIndex, selectLastInput, allInputs) {

            // Need to ensure column and row index are in range
            if (this._targetRowAvailable(rowIndex) && this._targetColumnAvailable(rowIndex, columnIndex)){

                this._blurActiveCell();
                this.activeCell = this._getRow(rowIndex).cells[columnIndex];
                this.activeRowIndex = rowIndex;
                this.activeColumnIndex = columnIndex;
                var focusableElements = this._getFocusableElements(this.activeCell, allInputs);
                if (focusableElements.length>0) {
                    if (selectLastInput) {
                        this.activeCellInput = focusableElements[focusableElements.length-1];
                    }
                    else {
                        this.activeCellInput = focusableElements[0];
                    }
                }
                else {
                    this.activeCellInput = null;
                }
                this._focusActiveCell();

            }
        },

        /**
         * Check if cell is editable. Editable is defined by the following:
         * - Cell is not hidden
         * - Cell is not disabled
         * - Cell contains a trigger element
         * @param rowIndex - index of the row
         * @param columnIndex - index of the column
         */
        _cellIsEditable: function (rowIndex, columnIndex){
            var node = this._getTriggerOfCellNode(this._getRow(rowIndex).cells[columnIndex]);
            return node !==null && !this._isTriggerDisabledByElement(node) && !this.isElementHidden(node);
        },

        /**
         * Add active class to TD and set focus to input (if exists)
         * @param rowIndex - index of the row
         * @param columnIndex - index of the column
         */
        _focusActiveCell: function() {
            // we have to set teh style on the cellContainer because slds requires this to be on the same element as slds-cell-edit and not on the TD
            var cellContainer = this.activeCell.querySelector(".cellContainer");
            $A.util.addClass((cellContainer)?cellContainer:this.activeCell, "slds-has-focus");
            this._focusActiveCellInput();
        },

        /**
         * Blur activeCell, remove active class, blur activeCell input (if exists)
         * @param rowIndex
         * @param columnIndex
         */
        _blurActiveCell: function(){
            // TODO: Find a concrete solution to set a cell as active
            $A.util.removeClass(this.table.querySelector(".slds-has-focus"), "slds-has-focus");
            this._blurActiveCellInput();
        },

        /*
         * Helper function to move to next column on the grid
         * @param rowIndex - index of the row
         * @param columnIndex - index of the column
         * @param allInputs - won't skip any input elements. This is the TAB usecase
         * @param wrapAround - if true the code will move to the next row if we are in the last column
         */
        _gotoNextCell: function(rowIndex, columnIndex, allInputs, wrapAround) {

            var currentRow = $A.util.isUndefined(rowIndex) ? this.activeRowIndex : rowIndex;
            var currentColumn = $A.util.isUndefined(columnIndex) ? this.activeColumnIndex : columnIndex;

            this._traverseColumns(currentRow, currentColumn, "next", allInputs, wrapAround);
        },

        /*
         * Helper function to move to previous column on the grid
         * @param rowIndex - index of the row
         * @param columnIndex - index of the column
         * @param allInputs = won't skip any input elements. This is the TAB usecase
         * @param wrapAround - if true the code will move to the next row if we are in the last column
         */
        _gotoPreviousCell: function(rowIndex, columnIndex, allInputs, wrapAround) {

            var currentRow = $A.util.isUndefined(rowIndex) ? this.activeRowIndex : rowIndex;
            var currentColumn = $A.util.isUndefined(columnIndex) ? this.activeColumnIndex : columnIndex;

            this._traverseColumns(currentRow, currentColumn, "prev", allInputs, wrapAround);
        },

        /*
         * Helper function to traverse columns on the grid, active class is added to 'active' cells
         * @param currentRow - Index of the current row
         * @param targetColumn - Index of the target column
         * @param direction - either next or prev
         * @param allInputs = won't skip any input elements. This is the TAB usecase
         * @param wrapAround - if true the code will move to the next row if we are in the last column
         */
        _traverseColumns: function(currentRow, currentColumn, direction, allInputs, wrapAround) {

            // Checking for multiple inputs in a cell
            // If multiple inputs, focus each input in order without moving out of the active cell state
            // this will also keep track of the active cell input
            var elements = this._getFocusableElements(this.activeCell, allInputs);
            var index = elements.indexOf(this.activeCellInput);

            if (index !== -1 && direction === "next" && index+1<elements.length) { // move next internally
                var nextInput = elements[index+1];
                this._focusElement(nextInput);
                this.activeCellInput = nextInput;
            }
            else if (index !== -1 && direction === "prev" && index-1>=0) { // move previous internally
                var prevInput = elements[index-1];
                this._focusElement(prevInput);
                this.activeCellInput = prevInput;
            }
            else { // this moves to another cell
                var columns = this._getRow(currentRow).cells,
                    targetColumn = currentColumn;
                if (direction === "next") {
                    targetColumn++;
                    while (targetColumn<columns.length && this.isElementHidden(columns[targetColumn])) {
                        targetColumn++;
                    }
                }
                else { // prev
                    targetColumn--;
                    while (targetColumn>0 && this.isElementHidden(columns[targetColumn])) {
                        targetColumn--;
                    }
                }
                if (this._targetColumnAvailable(currentRow, targetColumn)){
                    var selectLastInput = (direction === "prev");
                    this._setActiveCell(currentRow, targetColumn, selectLastInput, allInputs);
                }
                else if (wrapAround) {
                    var columnIndex;
                    if (targetColumn>=columns.length) { // out of bounds, next, so we have to move down
                        // we hit the last column and want to wrap to the next row
                        columnIndex = this._findUsableColumnInRow(true, currentRow+1, false, false);
                        if (columnIndex !== -1) {
                            this._gotoNextRow(currentRow, columnIndex);
                        }
                    }
                    else if (targetColumn<0) { // out of bounds, prev, so we have to move up
                        // we hit the first column and want to wrap to the previous row
                        columnIndex = this._findUsableColumnInRow(false, currentRow - 1, false, false);
                        if (columnIndex !== -1) {
                            this._gotoPreviousRow(currentRow, columnIndex);
                        }
                    }
                }
            }
        },

        /*
         * Helper function to move to the next row on the grid
         * @param rowIndex - index of the row
         * @param columnIndex - index of the column
         */
        _gotoNextRow: function(rowIndex, columnIndex){

            var currentColumn = $A.util.isUndefined(columnIndex) ? this.activeColumnIndex : columnIndex;
            var currentRow = $A.util.isUndefined(rowIndex) ? this.activeRowIndex : rowIndex;
            var targetRow = currentRow+1;

            this._traverseRows(targetRow, currentColumn, 'next');
        },

        /*
         * Helper function to move to the previous row on the grid
         * @param rowIndex - index of the row
         * @param columnIndex - index of the column
         */
        _gotoPreviousRow: function(rowIndex, columnIndex){

            var currentColumn = $A.util.isUndefined(columnIndex) ? this.activeColumnIndex : columnIndex;
            var currentRow = $A.util.isUndefined(rowIndex) ? this.activeRowIndex : rowIndex;
            var targetRow = currentRow-1;

            this._traverseRows(targetRow, currentColumn, 'previous');
        },

        /*
         * Helper function to move to previous/next rows on the grid
         * @param targetRow - Index of the target row
         * @param currentColumn - Index of the current column
         */
        _traverseRows: function(targetRow, currentColumn){

            if (this._targetRowAvailable(targetRow)){

                // if we navigate rows but had multiple inputs in the previous cell and the focused one was not the first
                // one, then we need to keep the focus on the same level.
                var selectLastInput = false;
                if (this._activeCellExists()) {
                    var elements = this._getFocusableElements(this.activeCell);
                    var index = elements.indexOf(this.activeCellInput);
                    if (index === elements.length-1) {
                        // the cell we are coming from has the last input selected
                        selectLastInput = true;
                    }
                }

                this._setActiveCell(targetRow, currentColumn, selectLastInput);
            }
        },

        /*
         * Helper function to move to first enabled cell on the active row
         */
        _gotoFirstEnabledCellInRow: function() {
            var rowIndex = this.activeRowIndex;
            var columnIndex = 0;

            if (this._isTriggerDisabled(rowIndex, columnIndex)){
                this._gotoNextCell(rowIndex, columnIndex);
            } else {
                this._setActiveCell(rowIndex, columnIndex);
            }
        },

        /*
         * Helper function to move to last enabled cell on the on the active row
         */
        _gotoLastEnabledCellInRow: function() {
            var rowIndex = this.activeRowIndex;
            var columnIndex = this._getRow(rowIndex).cells.length-1;

            if (this._isTriggerDisabled(rowIndex, columnIndex)){
                this._gotoNextCell(rowIndex, columnIndex);
            } else {
                this._setActiveCell(rowIndex, columnIndex);
            }
        },

        /**
         * Main event handler for keyboard interactions on the grid
         * @param e - event
         */
        _onKeydown: function (e) {

            if (this.keyboardModePaused) {
                return;
            }

            var stopEvent = function() {
                // Prevent default actions/events
                e.preventDefault();
                e.stopPropagation();
            };

            var _context = this;
            var cmp = _context.cmp;
            var _KEY_CODES = _context._KEY_CODES;

            switch (e.keyCode) {

                /**
                 * Basic Exit
                 */
                case _KEY_CODES.esc:
                    stopEvent();
                    _context.exitKeyboardMode(cmp);
                    break;

                /**
                 * Basic Navigation Keys
                 */
                case _KEY_CODES.backspace:
                    stopEvent();
                    _context._gotoPreviousCell();
                    break;

                case _KEY_CODES.tab:
                    stopEvent();
                    // go to previous or nextcell and don't skip any inputs and wrap around the row if we hit the first or last column
                    var allInputs = true,
                        wrapAround = true;
                    if (e.shiftKey) {
                        _context._gotoPreviousCell(undefined, undefined, allInputs, wrapAround);
                    } else {
                        _context._gotoNextCell(undefined, undefined, allInputs, wrapAround);
                    }
                    // TODO: Enable this once we can recognize whether a tab or shift tab closed the panel
                    //this._triggerEditOnActiveCell(true);
                    break;

                case _KEY_CODES.leftArrow:
                    stopEvent();
                    _context._gotoPreviousCell();
                    break;

                case _KEY_CODES.upArrow:
                    stopEvent();
                    _context._gotoPreviousRow();
                    break;

                case _KEY_CODES.rightArrow:
                    stopEvent();
                    _context._gotoNextCell();
                    break;

                case _KEY_CODES.downArrow:
                    // if we encounter a popup menu we don't use the arrow key so that the menu itself is opened
                    if (this.activeCellInput && this.activeCellInput.getAttribute("aria-haspopup") === "true") {
                        return;
                    }
                    stopEvent();
                    _context._gotoNextRow();
                    break;

                /**
                 * Basic Interaction Keys
                 */
                case _KEY_CODES.enter:
                    // we don't have to do anything special as we just want to trigger the focused element with normal browser means
                    break;

                case _KEY_CODES.space:
                    // we don't have to do anything special as we just want to trigger the focused element with normal browser means
                    break;

                /**
                 * Advanced Navigation Keys
                 */
                case _KEY_CODES.pageUp:
                    stopEvent();
                    // Got to first visible row in the viewport
                    break;

                case _KEY_CODES.pageDown:
                    stopEvent();
                    // Got to last visible row in the viewport
                    break;

                case _KEY_CODES.home:
                    stopEvent();
                    // TODO: Temporarily disable
                    //_context._gotoFirstEnabledCellInRow();
                    break;

                case _KEY_CODES.end:
                    stopEvent();
                    // TODO: Temporarily disable
                    //_context._gotoLastEnabledCellInRow();
                    break;

                /**
                 * Advanced Interaction Keys
                 */
                case _KEY_CODES.s:
                    if (e.ctrlKey) {
                        stopEvent();
                        // trigger save
                        cmp.helper.fireShortcutSaveEvent(cmp);
                    }
                    break;
                case _KEY_CODES.period:
                    if (e.ctrlKey) {
                        stopEvent();
                        // trigger cancel
                        cmp.helper.fireShortcutCancelEvent(cmp);
                    }
                    break;
            }
        },

        /**
         * Main event handler for click interactions on the grid
         * @param e
         */
        _onClick: function (e) {
            if (this.keyboardModePaused) {
                return;
            }

            var cellLocation = this._getClickedCellLocation(e);

            // Check if keyboard mode is enabled, if disabled, enable it
            if (!this.inKeyboardMode){
                this.enterKeyboardMode(this.cmp, null, true);
            }

            this._setActiveCell(cellLocation.row, cellLocation.column);
        },

        /**
         * Main event handler for click interactions on the grid
         * @param e
         */
        _onDoubleClick: function (e) {
            if (this.keyboardModePaused) {
                return;
            }

            var cellLocation = this._getClickedCellLocation(e);

            // Check if keyboard mode is enabled, if disabled, enable it
            if (!this.inKeyboardMode){
                this.enterKeyboardMode(this.cmp, null, true);
            }

            this._setActiveCell(cellLocation.row, cellLocation.column);
            this._triggerEditOnActiveCell(true);
        },

        /**
         * Get the location of the clicked cell (row, column)
         * @param e
         * @return {row: x, column: x}
         */
        _getClickedCellLocation: function(e){

            // relatedTarget is used for blur event, target is used for click event
            var cell = this._getCellElement(e.relatedTarget?e.relatedTarget:e.target),
                isHeaderCell = this._isHeaderRow(cell);

            return {
                row: (isHeaderCell) ? 0 : cell.parentElement.rowIndex-1+1, // +1 to offset the header
                column: cell.cellIndex
            };
        },

        /**
         * Gets the closest ancestor of match "TD" or "TH" of the specified element
         */
        _getCellElement: function(element) {

            while (element.nodeName !== "TD" && element.nodeName !== "TH") {
                element = element.parentElement;
            }

            return element;
        },

        /**
         * Helper Object that contains the supported keyboard codes constants for interaction/navigation
         */
        _KEY_CODES: {

            // Entry/Exit
            esc:27,

            // Basic navigation
            backspace:8,
            tab:9,
            leftArrow:37,
            upArrow:38,
            rightArrow:39,
            downArrow:40,

            // Basic Interaction
            enter:13,
            space:32,

            // Advanced navigation
            pageUp:33,
            pageDown:34,
            end:35,
            home:36,

            // Shortcut keys
            shift:16,
            ctrl:17,
            alt:18,
            s: 83,
            period:190
        },

        /**
         * Helper constants to keep track of class names
         */
        ACTIVE_CELL_CLASS: 'slds-has-focus'
    };

    // TODO: Library needs to return a new instance of the object for each grid, rather than one single lib object
    return new KeyboardNavManager();
}