#!/usr/bin/env bash
# Records whether each hosted form platform is reachable from the build environment.
#
# This exists because "Experimental" is a claim about the environment, not about the code, and a
# reader should be able to re-run the one command that substantiates it. If every platform line
# below comes back reachable, the four experimental adapters can and should be promoted by testing
# them against the live products.
set -u
echo "probe date: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "target                       http  verdict"
for host in \
  docs.google.com \
  forms.office.com \
  form.typeform.com \
  www.jotform.com \
  www.surveymonkey.com \
  registry.npmjs.org \
  raw.githubusercontent.com
do
  # curl writes 000 into http_code when the connection itself never completed, so the exit status
  # is captured separately rather than folded into the code with `||`, which concatenated two
  # values and inverted the verdict in the first version of this script.
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 12 "https://$host/" 2>/dev/null)
  status=$?
  if [ "$status" -ne 0 ] || [ "$code" = "000" ]; then
    verdict="UNREACHABLE (curl exit $status)"
  else
    verdict="reachable"
  fi
  printf "%-28s %5s  %s\n" "$host" "$code" "$verdict"
done
