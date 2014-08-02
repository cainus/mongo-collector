REPORTER = dot

prepare:
	@npm install

test-lint:
	@./node_modules/.bin/jshint index.js ./test

test: test-lint
	@NODE_ENV=testing ./node_modules/.bin/mocha \
	 --reporter $(REPORTER)	--recursive test --timeout 10000

test-cov: test-lint
	@NODE_ENV=testing \
	  ./node_modules/.bin/istanbul cover \
		./node_modules/.bin/_mocha -- test \
	 -u exports --R spec	--timeout 10000 --recursive
	echo "html coverage report has been created at ./coverage/lcov-report/index.html"

.PHONY: test
