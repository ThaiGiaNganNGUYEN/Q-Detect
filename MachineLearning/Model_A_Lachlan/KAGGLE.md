Push the kernel (notebook + metadata only; `best_params.json` is attached as a dataset):

```
kaggle kernels push -p /Users/lachlanbruce/Documents/QDetect_CODE/Q-Detect/MachineLearning/Model_A_Lachlan
```

Create or update the params dataset (do not run `kaggle datasets create` on this folder — it would upload `ibmdata.csv` and `.pt` files):

```
mkdir -p /tmp/qgnn-best-params
cp /Users/lachlanbruce/Documents/QDetect_CODE/Q-Detect/MachineLearning/Model_A_Lachlan/best_params.json /tmp/qgnn-best-params/
# first time:
#   kaggle datasets create -p /tmp/qgnn-best-params
# later:
kaggle datasets version -p /tmp/qgnn-best-params -m "update best_params"
```
