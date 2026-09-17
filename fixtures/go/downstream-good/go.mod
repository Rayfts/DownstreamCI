module example.com/fixture-go-downstream

go 1.22

require example.com/fixture-go-lib v0.0.0
replace example.com/fixture-go-lib => ../upstream-lib
